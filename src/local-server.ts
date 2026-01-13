/**
 * Local HTTP server that mimics GitHub Advisories REST API
 * Serves advisory data from local repository
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { LocalRepositoryDataSource } from './datasources/local-repository.js';
import { AdvisoryListOptions } from './types/data-source.js';

export interface LocalServerConfig {
  repositoryPath: string;
  port?: number;
  host?: string;
}

/**
 * Create and start a local HTTP server for advisory data
 */
export async function createLocalAdvisoryServer(config: LocalServerConfig) {
  const app = express();
  const port = config.port || 3000;
  const host = config.host || 'localhost';

  const dataSource = new LocalRepositoryDataSource(config.repositoryPath);

  // Enable CORS for browser access
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      source: 'local-repository',
      repository: config.repositoryPath,
    });
  });

  // List advisories (mimics GET /advisories)
  app.get('/advisories', async (req: Request, res: Response) => {
    try {
      const options: AdvisoryListOptions = {
        ghsa_id: req.query.ghsa_id as string,
        cve_id: req.query.cve_id as string,
        ecosystem: req.query.ecosystem as string,
        severity: req.query.severity as string,
        cwes: req.query.cwes ? (Array.isArray(req.query.cwes) ? req.query.cwes as string[] : [req.query.cwes as string]) : undefined,
        is_withdrawn: req.query.is_withdrawn === 'true' ? true : req.query.is_withdrawn === 'false' ? false : undefined,
        affects: req.query.affects as string,
        published: req.query.published as string,
        updated: req.query.updated as string,
        modified: req.query.modified as string,
        per_page: req.query.per_page ? parseInt(req.query.per_page as string) : undefined,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        sort: (req.query.sort as 'published' | 'updated') || 'published',
        direction: (req.query.direction as 'asc' | 'desc') || 'desc',
      };

      const advisories = await dataSource.listAdvisories(options);
      res.json(advisories);
    } catch (error) {
      console.error('Error listing advisories:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Get specific advisory (mimics GET /advisories/{ghsa_id})
  app.get('/advisories/:ghsa_id', async (req: Request, res: Response) => {
    try {
      const advisory = await dataSource.getAdvisory(req.params.ghsa_id);
      
      // Return 404 if advisory not found (GitHub API behavior)
      if (advisory === null) {
        res.status(404).json({
          message: 'Not Found',
          documentation_url: 'https://docs.github.com/rest/security-advisories/global-advisories',
        });
        return;
      }
      
      res.json(advisory);
    } catch (error) {
      console.error(`Error getting advisory ${req.params.ghsa_id}:`, error);
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({
          error: 'Not found',
          message: error.message,
        });
      } else {
        res.status(500).json({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  });

  // Search advisories (custom endpoint for convenience)
  app.get('/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ error: 'Missing query parameter: q' });
        return;
      }

      const options: AdvisoryListOptions = {
        ecosystem: req.query.ecosystem as string,
        severity: req.query.severity as string,
        per_page: req.query.per_page ? parseInt(req.query.per_page as string) : undefined,
      };

      const advisories = await dataSource.searchAdvisories!(query, options);
      res.json(advisories);
    } catch (error) {
      console.error('Error searching advisories:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Start server
  return new Promise<{ server: any; url: string }>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.error(`Local Advisory Server listening at ${url}`);
      console.error(`Repository: ${config.repositoryPath}`);
      console.error(`Endpoints:`);
      console.error(`  GET ${url}/health`);
      console.error(`  GET ${url}/advisories`);
      console.error(`  GET ${url}/advisories/:ghsa_id`);
      console.error(`  GET ${url}/search?q=<query>`);
      resolve({ server, url });
    }).on('error', reject);
  });
}

/**
 * Standalone server CLI
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const repoPath = process.env.ADVISORY_REPO_PATH || process.argv[2];
  const port = parseInt(process.env.PORT || process.argv[3] || '3000');

  if (!repoPath) {
    console.error('Usage: node local-server.js <repository-path> [port]');
    console.error('   or: ADVISORY_REPO_PATH=<path> PORT=<port> node local-server.js');
    process.exit(1);
  }

  createLocalAdvisoryServer({ repositoryPath: repoPath, port })
    .then(({ url }) => {
      console.error(`\nServer ready! Test with:`);
      console.error(`  curl ${url}/health`);
      console.error(`  curl "${url}/advisories?ecosystem=npm&per_page=5"`);
    })
    .catch((error) => {
      console.error('Failed to start server:', error);
      process.exit(1);
    });
}
