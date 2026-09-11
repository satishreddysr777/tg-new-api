/**
 * TLS options for postgres-js when talking to a managed database that uses
 * its own certificate authority (DigitalOcean injects the cluster CA as
 * DATABASE_CA_CERT). Returns undefined when no CA is configured so local dev
 * and tests keep the plain connection-string behaviour.
 */
export type DbSsl = { ca: string; rejectUnauthorized: true };

export function sslOptions(caCert: string | undefined): DbSsl | undefined {
  const ca = caCert?.trim();
  if (!ca) return undefined;
  return { ca, rejectUnauthorized: true };
}
