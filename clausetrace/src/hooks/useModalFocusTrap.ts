import { useEffect, useRef } from 'react';

/**
 * Accessible Focus Trap Hook for Modals & Dialogs
 * 
 * - Traps Tab and Shift+Tab navigation within the dialog container
 * - Automatically focuses the initial focusable element or container upon opening
 * - Closes modal on Escape key press
 * - Restores focus to the triggering element when the modal unmounts/closes
 */
export function useModalFocusTrap(
  isOpen: boolean,
  onClose: () => void,
  options?: {
    initialFocusSelector?: string;
    closeOnEscape?: boolean;
  }
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!isOpen) {
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
        triggerRef.current = null;
      }
      return;
    }

    // Store triggering element when modal opens
    if (!triggerRef.current && document.activeElement) {
      triggerRef.current = document.activeElement as HTMLElement;
    }

    const container = containerRef.current;
    if (!container) return;

    // Set focus only if activeElement is NOT already inside the container
    if (!container.contains(document.activeElement)) {
      const focusableElements = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (optionsRef.current?.initialFocusSelector) {
        const initialEl = container.querySelector<HTMLElement>(optionsRef.current.initialFocusSelector);
        if (initialEl) initialEl.focus();
      } else if (focusableElements.length > 0) {
        focusableElements[0].focus();
      } else {
        container.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && optionsRef.current?.closeOnEscape !== false) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return containerRef;
}
