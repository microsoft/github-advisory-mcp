import winston from 'winston';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';

// OpenTelemetry instrumentation
const winstonInstrumentation = new WinstonInstrumentation({
  enabled: true,
  logHook: (span, record) => {
    record['resource.service.name'] = 'advisory-mcp';
  }
});

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format with colors for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    const comp = component ? `[${component}]` : '[Advisory]';
    let msg = `${timestamp} ${comp} ${level}: ${message}`;
    
    const metaKeys = Object.keys(meta).filter(k => 
      !['timestamp', 'level', 'message', 'component', 'service', 'environment'].includes(k)
    );
    if (metaKeys.length > 0) {
      const metaObj: Record<string, any> = {};
      metaKeys.forEach(k => metaObj[k] = meta[k]);
      msg += ` ${JSON.stringify(metaObj)}`;
    }
    
    return msg;
  })
);

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  format: structuredFormat,
  defaultMeta: {
    service: 'advisory-mcp',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
      stderrLevels: ['error'],
    })
  ],
  exitOnError: false
});

// Child logger for components
export function createLogger(component: string) {
  return logger.child({ component });
}

// Export instrumentation for telemetry setup
export { winstonInstrumentation };
