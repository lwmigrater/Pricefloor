import { createContext, useContext, useCallback, ReactNode } from 'react';

interface ToastOptions {
  message: string;
  error?: boolean;
  duration?: number;
  onDismiss?: () => void;
}

interface ToastContextType {
  showToast: (options: ToastOptions | string) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: ReactNode;
}

declare global {
  interface Window {
    shopify?: {
      toast?: {
        show: (message: string, options?: { isError?: boolean; duration?: number }) => void;
        hide?: () => void;
      };
    };
  }
}

export const ToastProvider = ({ children }: ToastProviderProps) => {
  const showToast = useCallback((options: ToastOptions | string) => {
    const message = typeof options === 'string' ? options : options.message;
    const isError = typeof options === 'string' ? false : options.error || false;
    const duration = typeof options === 'string' ? 3000 : options.duration || 3000;

    if (typeof window !== 'undefined' && window.shopify?.toast?.show) {
      window.shopify.toast.show(message, { isError, duration });
    }
  }, []);

  const hideToast = useCallback(() => {
    if (typeof window !== 'undefined' && window.shopify?.toast?.hide) {
      window.shopify.toast.hide();
    }
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
    </ToastContext.Provider>
  );
};
