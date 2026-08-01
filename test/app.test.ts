import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/stacks/network-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { ComputeStack } from '../lib/stacks/compute-stack';
import { ServerlessStack } from '../lib/stacks/serverless-stack';
import { environments } from '../lib/config/environments';

/**
 * Regression test for the dependency cycle between DatabaseStack and
 * ComputeStack.
 *
 * The app previously passed the DatabaseCluster construct into ComputeStack and
 * called `database.connections.allowFrom(service, ...)`. That put the ingress
 * rule on the database's security group — in DatabaseStack — while referencing
 * ComputeStack's service security group, so each stack depended on the other
 * and `cdk synth` failed with «DependencyCycle». Synthesising the whole app is
 * the only thing that catches it; per-stack tests all pass either way.
 */
function buildApp(envName: string): cdk.App {
  const app = new cdk.App();
  const config = environments[envName];
  const env = { account: '111111111111', region: config.region };

  const networkStack = new NetworkStack(app, `${envName}-NetworkStack`, {
    env,
    config: config.vpc,
  });

  const databaseStack = new DatabaseStack(app, `${envName}-DatabaseStack`, {
    env,
    vpc: networkStack.vpc,
    config: config.database,
  });

  new ComputeStack(app, `${envName}-ComputeStack`, {
    env,
    vpc: networkStack.vpc,
    config: config.ecs,
    databaseSecurityGroupId: databaseStack.securityGroup.securityGroupId,
    databaseEndpoint: databaseStack.database.clusterEndpoint.hostname,
    databasePort: DatabaseStack.PORT,
    databaseSecretArn: databaseStack.secret.secretArn,
  });

  new ServerlessStack(app, `${envName}-ServerlessStack`, {
    env,
    vpc: networkStack.vpc,
    config: config.serverless,
  });

  return app;
}

describe('app', () => {
  test.each(Object.keys(environments))(
    'synthesizes %s without a dependency cycle',
    (envName) => {
      const assembly = buildApp(envName).synth();
      expect(assembly.stacks).toHaveLength(4);
    }
  );

  test('ComputeStack depends on DatabaseStack and not the other way round', () => {
    const assembly = buildApp('dev').synth();

    const compute = assembly.getStackByName('dev-ComputeStack');
    const database = assembly.getStackByName('dev-DatabaseStack');

    expect(compute.dependencies.map((d) => d.id)).toContain('dev-DatabaseStack');
    expect(database.dependencies.map((d) => d.id)).not.toContain('dev-ComputeStack');
  });

  test('every environment config is complete enough to build all four stacks', () => {
    for (const [name, config] of Object.entries(environments)) {
      expect(config.region).toBeTruthy();
      expect(config.vpc.maxAzs).toBeGreaterThanOrEqual(2);
      expect(config.ecs.maxCapacity).toBeGreaterThanOrEqual(config.ecs.minCapacity);
      expect(config.database.maxCapacity).toBeGreaterThanOrEqual(
        config.database.minCapacity
      );
      expect(typeof config.serverless.retainData).toBe('boolean');
      expect(name).toBeTruthy();
    }
  });
});
