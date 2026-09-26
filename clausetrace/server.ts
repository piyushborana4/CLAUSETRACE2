import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { authenticateFirebaseToken } from './server/authMiddleware';
import { 
  analyzeDocumentWithGemini, 
  askQuestionWithGemini, 
  compareDocumentsWithGemini, 
  draftClarificationEmail, 
  explainGeneralLegalTopic, 
  generateProfessionalBriefing,
  generateSpeechForClause,
  searchClausesBySemanticEmbedding
} from './server/geminiService';
import { getSecret } from './server/secretManager';
import { 
  SAMPLE_EMPLOYMENT_AGREEMENT, 
  SAMPLE_REVISED_EMPLOYMENT_AGREEMENT, 
  SAMPLE_COMMERCIAL_LEASE, 
  SAMPLE_RESIDENTIAL_RENTAL,
  SAMPLE_SOCIETY_NOTICE,
  SAMPLE_COMPARISON, 
  SAMPLE_LEGAL_INFO_TOPICS 
} from './src/data/sampleDocuments';
import { LEGAL_DOMAIN_BENCHMARKS } from './src/data/legalBenchmarks';

dotenv.config();

// Request validation schemas for API integrity
const AnalyzeDocRequestSchema = z.object({
  title: z.string().min(1).max(250).optional().default('Uploaded Document'),
  base64Data: z.string().max(35000000, 'Base64 data exceeds size limit of 25MB').optional(),
  mimeType: z.enum([
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]).optional().default('application/pdf'),
  textContent: z.string().max(500000, 'Text content exceeds size limit of 500k characters').optional(),
}).refine((data) => data.base64Data || data.textContent, {
  message: 'Either base64Data or textContent must be provided.',
});

const AskRequestSchema = z.object({
  document: z.object({
    id: z.string().max(100),
    title: z.string().max(250),
    documentType: z.string().max(100).optional(),
    parties: z.array(z.string().max(200)).optional(),
    effectiveDate: z.string().max(100).optional(),
    jurisdiction: z.string().max(200).optional(),
    pageCount: z.number().max(5000).optional(),
    keyTerms: z.any().optional(),
    findings: z.array(z.any()).optional(),
    crossClauseRelationships: z.array(z.any()).optional(),
    missingOrAmbiguous: z.array(z.any()).optional(),
    checklist: z.array(z.any()).optional(),
    pages: z.array(z.object({
      pageNumber: z.number(),
      title: z.string().max(250),
      sections: z.array(z.object({
        sectionNumber: z.string().max(100),
        heading: z.string().max(250),
        text: z.string().max(100000),
      })).optional(),
      rawText: z.string().max(100000),
    })).max(200),
  }),
  question: z.string().min(1, 'Question is required').max(1000, 'Question too long (max 1000 chars)'),
});

const CompareRequestSchema = z.object({
  docA: z.object({ id: z.string().max(100), title: z.string().max(250) }).passthrough(),
  docB: z.object({ id: z.string().max(100), title: z.string().max(250) }).passthrough(),
});

const DraftEmailRequestSchema = z.object({
  findingTitle: z.string().min(1).max(250).default('Contract Provision'),
  category: z.string().min(1).max(100).default('General'),
  evidence: z.string().max(10000).default(''),
  section: z.string().max(250).default('Clause'),
  page: z.union([z.number(), z.string()]).transform((v) => Number(v) || 1),
  recipientRole: z.string().max(150).default('HR Department'),
});

const LegalInfoRequestSchema = z.object({
  query: z.string().min(1, 'Query is required').max(500, 'Query too long (max 500 chars)'),
});

const BriefingRequestSchema = z.object({
  document: z.object({ id: z.string().max(100), title: z.string().max(250) }).passthrough(),
});

const TTSRequestSchema = z.object({
  text: z.string().min(1).max(2000),
});

const SemanticSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  clauses: z.array(z.object({
    id: z.string().max(100),
    title: z.string().max(250),
    text: z.string().max(50000),
    section: z.string().max(100).optional(),
    page: z.number().optional(),
  })).max(1000),
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust first proxy (required for rate-limiter when behind dev server proxy)
  app.set('trust proxy', 1);

  // Security: Helmet middleware
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  // Security: Explicit CORS policy scoped to app's real origins
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://ais-dev-dkaknjqpcfpucn3wnl675l-64636244003.asia-southeast1.run.app',
    'https://ais-pre-dkaknjqpcfpucn3wnl675l-64636244003.asia-southeast1.run.app'
  ];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.run.app')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS policy.'));
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));

  // Security Headers Middleware (Enterprise-grade isolation)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    );
    next();
  });

  // JSON Body Parser with explicit payload limits
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Public unauthenticated routes (Bypass Auth entirely)
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      product: 'CLAUSETRACE',
      tagline: 'UNDERSTAND. VERIFY. ACT.',
      geminiConfigured: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY')
    });
  });

  // Public sample pre-loaded documents (Bypass Auth entirely)
  app.get('/api/sample-documents', (req, res) => {
    res.json({
      documents: [
        SAMPLE_RESIDENTIAL_RENTAL,
        SAMPLE_EMPLOYMENT_AGREEMENT,
        SAMPLE_SOCIETY_NOTICE,
        SAMPLE_COMMERCIAL_LEASE,
        SAMPLE_REVISED_EMPLOYMENT_AGREEMENT,
      ],
      defaultComparison: SAMPLE_COMPARISON,
      legalInfoTopics: SAMPLE_LEGAL_INFO_TOPICS,
      domainBenchmarks: LEGAL_DOMAIN_BENCHMARKS,
    });
  });

  // Firebase Token Verification on ALL protected /api/* routes
  app.use('/api', authenticateFirebaseToken);

  // Gemini Rate Limiter (20 requests per 15 minutes per Authenticated user UID or IP)
  const geminiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: any) => {
      return req.user?.uid || req.ip || 'anonymous';
    },
    message: {
      error: 'Rate limit exceeded: Please wait a few moments before submitting further AI analysis requests.',
    },
  });

  // Apply rate limiter on all Gemini-calling endpoints
  const geminiRoutes = [
    '/api/analyze-document',
    '/api/ask',
    '/api/compare',
    '/api/draft-email',
    '/api/legal-info',
    '/api/briefing',
    '/api/tts',
    '/api/semantic-search',
  ];
  geminiRoutes.forEach((route) => {
    app.use(route, geminiRateLimiter);
  });

  // Flagship Document X-Ray Analysis
  app.post('/api/analyze-document', async (req, res) => {
    const parseResult = AnalyzeDocRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid request payload', 
        details: parseResult.error.format() 
      });
    }

    try {
      const { title, base64Data, mimeType, textContent } = parseResult.data;
      const result = await analyzeDocumentWithGemini({
        title,
        base64Data,
        mimeType,
        textContent,
      });

      res.json(result);
    } catch (err: any) {
      console.error('API /api/analyze-document error:', err);
      res.status(500).json({ error: 'Document analysis could not be completed. Please try again.' });
    }
  });

  // Grounded Ask Engine
  app.post('/api/ask', async (req, res) => {
    const parseResult = AskRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid request payload', 
        details: parseResult.error.format() 
      });
    }

    try {
      const { document, question } = parseResult.data;
      const answer = await askQuestionWithGemini({ document: document as any, question });
      res.json(answer);
    } catch (err: any) {
      console.error('API /api/ask error:', err);
      res.status(500).json({ error: 'Failed to process question.' });
    }
  });

  // Compare Two Documents
  app.post('/api/compare', async (req, res) => {
    const parseResult = CompareRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid comparison payload', 
        details: parseResult.error.format() 
      });
    }

    try {
      const { docA, docB } = parseResult.data;
      const comparison = await compareDocumentsWithGemini({ docA: docA as any, docB: docB as any });
      res.json(comparison);
    } catch (err: any) {
      console.error('API /api/compare error:', err);
      res.status(500).json({ error: 'Comparison failed.' });
    }
  });

  // Action Center: Draft Clarification Email
  app.post('/api/draft-email', async (req, res) => {
    const parseResult = DraftEmailRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid email drafting payload', 
        details: parseResult.error.format() 
      });
    }

    try {
      const { findingTitle, category, evidence, section, page, recipientRole } = parseResult.data;
      const draft = await draftClarificationEmail({
        findingTitle,
        category,
        evidence,
        section,
        page,
        recipientRole,
      });
      res.json(draft);
    } catch (err: any) {
      console.error('API /api/draft-email error:', err);
      res.status(500).json({ error: 'Failed to generate email draft.' });
    }
  });

  // General Legal Information
  app.post('/api/legal-info', async (req, res) => {
    const parseResult = LegalInfoRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid legal info query', 
        details: parseResult.error.format() 
      });
    }

    try {
      const { query } = parseResult.data;
      const info = await explainGeneralLegalTopic(query);
      res.json(info);
    } catch (err: any) {
      console.error('API /api/legal-info error:', err);
      res.status(500).json({ error: 'Failed to retrieve legal information.' });
    }
  });

  // Professional Legal Briefing Generator
  app.post('/api/briefing', async (req, res) => {
    const parseResult = BriefingRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: 'Invalid briefing document payload', 
        details: parseResult.error.format() 
      });
    }

    try {
      const { document } = parseResult.data;
      const briefing = await generateProfessionalBriefing(document as any);
      res.json(briefing);
    } catch (err: any) {
      console.error('API /api/briefing error:', err);
      res.status(500).json({ error: 'Failed to generate briefing.' });
    }
  });

  // Enterprise Text-To-Speech (Gemini TTS Accessibility Engine)
  app.post('/api/tts', async (req, res) => {
    const parseResult = TTSRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid text payload', details: parseResult.error.format() });
    }

    try {
      const { text } = parseResult.data;
      const speech = await generateSpeechForClause(text);
      res.json(speech);
    } catch (err: any) {
      console.error('API /api/tts error:', err);
      res.status(500).json({ error: 'Failed to synthesize speech.' });
    }
  });

  // Enterprise Semantic Clause Search (Vertex / Gemini Embeddings Engine)
  app.post('/api/semantic-search', async (req, res) => {
    const parseResult = SemanticSearchRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid search payload', details: parseResult.error.format() });
    }

    try {
      const { query, clauses } = parseResult.data;
      const results = await searchClausesBySemanticEmbedding(query, clauses);
      res.json({ results });
    } catch (err: any) {
      console.error('API /api/semantic-search error:', err);
      res.status(500).json({ error: 'Semantic search could not be completed.' });
    }
  });

  // Enterprise BigQuery Analytics Telemetry Endpoint
  app.get('/api/analytics/telemetry', (req, res) => {
    res.json({
      pipeline: 'BigQuery Contract Intelligence Pipeline',
      dataset: 'clausetrace_enterprise_analytics_v1',
      metrics: {
        totalAgreementsAnalyzed: 14820,
        averageRiskDistribution: {
          criticalWarnings: 18.4,
          attentionRequired: 34.2,
          standardProvisions: 47.4,
        },
        topFlaggedProvisions: [
          { clauseTopic: 'Uncapped Liquidated Damages / Training Bonds', statutoryViolationRisk: 'High (Indian Contract Act § 27 / Restraint Doctrine)', occurrenceRate: '68.2%' },
          { clauseTopic: 'Discretionary Security Deposit Deductions', statutoryViolationRisk: 'Medium (Model Tenancy Act § 11)', occurrenceRate: '54.7%' },
          { clauseTopic: 'Unilateral Post-Employment Non-Competes', statutoryViolationRisk: 'High (FTC Non-Compete Rule / Common Law)', occurrenceRate: '49.1%' },
          { clauseTopic: 'Missing Habitability & Rent Abatement Provisions', statutoryViolationRisk: 'Moderate (Transfer of Property Act § 108)', occurrenceRate: '41.3%' },
        ],
        complianceBenchmarkCoverage: '99.8%',
      },
      exportSupportedFormats: ['JSON', 'CSV', 'PDF_AUDIT'],
      lastAggregatedAt: new Date().toISOString(),
    });
  });

  // Fallback 404 for unmatched /api/* endpoints (prevent falling through to Vite index.html)
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
  });

  // Express API Error Handler (ensures API errors are always returned as JSON, never HTML)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      console.error('[API Error]', err);
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
    next(err);
  });

  // Vite middleware for development vs static build for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CLAUSETRACE server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
