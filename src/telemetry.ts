import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { winstonInstrumentation, logger } from './logger.js';

const telemetryEnabled = process.env.TELEMETRY_ENABLED !== 'false';
const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT || 'http://localhost:4318';

let sdk: NodeSDK | null = null;

export function initTelemetry() {
  if (!telemetryEnabled) {
    logger.info('Telemetry disabled');
    return;
  }

  try {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'advisory-mcp',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    });

    sdk = new NodeSDK({
      resource,
      traceExporter: new OTLPTraceExporter({
        url: `${telemetryEndpoint}/v1/traces`,
      }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${telemetryEndpoint}/v1/metrics`,
        }),
        exportIntervalMillis: 10000,
      }),
      logRecordProcessor: undefined, // Winston handles logs
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
        winstonInstrumentation,
      ],
    });

    sdk.start();
    logger.info('OpenTelemetry initialized', { endpoint: telemetryEndpoint });
  } catch (error) {
    logger.warn('Failed to initialize telemetry', { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function shutdownTelemetry() {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('Telemetry shut down');
    } catch (error) {
      logger.error('Error shutting down telemetry', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await shutdownTelemetry();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await shutdownTelemetry();
  process.exit(0);
});
