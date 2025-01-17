import jwksClient, { type JwksClient, type SigningKey } from 'jwks-rsa';
import type { JwtHeader, VerifyErrors } from 'jsonwebtoken';
import jwt from 'jsonwebtoken';
import { getLocalConfig, saveLocalConfig } from '../config/local';
import type { CloudCliConfig, CLIContext } from '../types';
import { cloudApiFactory } from './cli-api';

let cliConfig: CloudCliConfig;

interface DecodedToken {
  [key: string]: any;
}

export async function tokenServiceFactory({ logger }: { logger: CLIContext['logger'] }) {
  const cloudApiService = await cloudApiFactory({ logger });

  async function saveToken(str: string) {
    const appConfig = await getLocalConfig();

    if (!appConfig) {
      logger.error('There was a problem saving your token. Please try again.');
      return;
    }

    appConfig.token = str;

    try {
      await saveLocalConfig(appConfig);
    } catch (e: Error | unknown) {
      logger.debug(e);
      logger.error('There was a problem saving your token. Please try again.');
    }
  }

  async function retrieveToken() {
    const appConfig = await getLocalConfig();
    if (appConfig.token) {
      // check if token is still valid
      if (await isTokenValid(appConfig.token)) {
        return appConfig.token;
      }
    }
    return undefined;
  }

  async function validateToken(idToken: string, jwksUrl: string): Promise<void> {
    const client: JwksClient = jwksClient({
      jwksUri: jwksUrl,
    });

    // Get the Key from the JWKS using the token header's Key ID (kid)
    const getKey = (header: JwtHeader, callback: (e: Error | null, key?: string) => void) => {
      client.getSigningKey(header.kid, (e: Error | null, key?: SigningKey) => {
        if (e) {
          callback(e);
        } else if (key) {
          const publicKey = 'publicKey' in key ? key.publicKey : key.rsaPublicKey;
          callback(null, publicKey);
        } else {
          callback(new Error('Key not found'));
        }
      });
    };

    // Decode the JWT token to get the header and payload
    const decodedToken = jwt.decode(idToken, { complete: true }) as DecodedToken;
    if (!decodedToken) {
      if (typeof idToken === 'undefined' || idToken === '') {
        logger.warn('You need to be logged in to use this feature. Please log in and try again.');
      } else {
        logger.error(
          'There seems to be a problem with your login information. Please try logging in again.'
        );
      }
    }

    // Verify the JWT token signature using the JWKS Key
    return new Promise<void>((resolve, reject) => {
      jwt.verify(idToken, getKey, (err: VerifyErrors | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async function isTokenValid(token: string) {
    try {
      const config = await cloudApiService.config();

      cliConfig = config.data;
      if (token) {
        await validateToken(token, cliConfig.jwksUrl);
        return true;
      }
      return false;
    } catch (e) {
      logger.debug(e);
      return false;
    }
  }

  async function eraseToken() {
    const appConfig = await getLocalConfig();
    if (!appConfig) {
      return;
    }

    delete appConfig.token;

    try {
      await saveLocalConfig(appConfig);
    } catch (e: Error | unknown) {
      logger.debug(e);
      logger.error(
        'There was an issue removing your login information. Please try logging out again.'
      );
      throw e;
    }
  }

  async function getValidToken() {
    const token = await retrieveToken();
    if (!token) {
      logger.log('No token found. Please login first.');
      return null;
    }

    if (!(await isTokenValid(token))) {
      logger.log('Unable to proceed: Token is expired or not valid. Please login again.');
      return null;
    }
    return token;
  }

  return {
    saveToken,
    retrieveToken,
    validateToken,
    isTokenValid,
    eraseToken,
    getValidToken,
  };
}
