import { errorBourndaryOptions } from 'src/screens/ErrorHandler';

import config from 'src/utils/service-utilities/config';

let Sentry: any = null;
let sentryConfig: any = null;

export const initSentrySDK = () => {
  if (!config.isDevMode()) return;

  if (!Sentry) {
    import('@sentry/react-native')
      .then((module) => {
        Sentry = module;
      })
      .catch((error) => {
        console.error('Failed to load Sentry:', error);
      });
  }
};

// Construct a new instrumentation instance. This is needed to communicate between the integration and React
// const routingInstrumentation = new Sentry.ReactNavigationInstrumentation();

const getSentryConfig = () => {
  sentryConfig = {
    maxBreadcrumbs: 50,
    tracesSampleRate: 1.0,
    dsn: config.SENTRY_DNS,
    environment: 'LOCAL',
  };
};

export const captureError = (error: Error, context?: any) => {
  try {
    if (!config.isDevMode()) return null;
    console.log('@captureError: ', error);
    return Sentry.captureException(error, context);
  } catch (err) {
    console.log(err);
  }
};

export const logMessage = (message: string, captureContext?: any) => {
  config.isDevMode() && Sentry.captureMessage(message, captureContext);
};

export const SentryWrapper = (App) => {
  if (Sentry) return Sentry.wrap(App);
  else return App;
};

export const SentryErrorBoundary = (component) => {
  if (Sentry) {
    return Sentry.withErrorBoundary(component, errorBourndaryOptions);
  } else {
    return component;
  }
};

export const initializeSentry = () => {
  if (config.isDevMode()) {
    if (!sentryConfig) getSentryConfig();
    return Sentry.init({ ...sentryConfig, enabled: true });
  }
  return null;
};

export const getRoutingInstrumentation = () =>
  Sentry ? new Sentry.ReactNavigationInstrumentation() : null;
