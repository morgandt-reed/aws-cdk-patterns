/**
 * Environment-specific configurations for CDK stacks.
 */

export interface VpcConfig {
  maxAzs: number;
  natGateways: number;
  enableFlowLogs: boolean;
}

export interface EcsConfig {
  desiredCount: number;
  cpu: number;
  memory: number;
  minCapacity: number;
  maxCapacity: number;
  useFargateSpot: boolean;
}

export interface DatabaseConfig {
  instanceType?: string;
  serverless: boolean;
  minCapacity: number;
  maxCapacity: number;
  multiAz: boolean;
  backupRetention: number;
}

export interface ServerlessConfig {
  memorySize: number;
  timeout: number;
  reservedConcurrency?: number;

  /**
   * Retain the DynamoDB table when the stack is deleted. True for any
   * environment holding data you cannot recreate.
   */
  retainData: boolean;
}

export interface EnvironmentConfig {
  account?: string;
  region: string;
  vpc: VpcConfig;
  ecs: EcsConfig;
  database: DatabaseConfig;
  serverless: ServerlessConfig;
}

export const environments: Record<string, EnvironmentConfig> = {
  dev: {
    region: 'us-west-2',
    vpc: {
      maxAzs: 2,
      natGateways: 1,
      enableFlowLogs: false,
    },
    ecs: {
      desiredCount: 1,
      cpu: 256,
      memory: 512,
      minCapacity: 1,
      maxCapacity: 4,
      useFargateSpot: true,
    },
    database: {
      serverless: true,
      minCapacity: 0.5,
      maxCapacity: 4,
      multiAz: false,
      backupRetention: 7,
    },
    serverless: {
      memorySize: 256,
      timeout: 30,
      retainData: false,
    },
  },

  staging: {
    region: 'us-west-2',
    vpc: {
      maxAzs: 2,
      natGateways: 1,
      enableFlowLogs: true,
    },
    ecs: {
      desiredCount: 2,
      cpu: 512,
      memory: 1024,
      minCapacity: 2,
      maxCapacity: 8,
      useFargateSpot: true,
    },
    database: {
      serverless: true,
      minCapacity: 1,
      maxCapacity: 8,
      multiAz: false,
      backupRetention: 14,
    },
    serverless: {
      memorySize: 512,
      timeout: 30,
      retainData: false,
    },
  },

  prod: {
    region: 'us-east-1',
    vpc: {
      maxAzs: 3,
      natGateways: 3,
      enableFlowLogs: true,
    },
    ecs: {
      desiredCount: 3,
      cpu: 1024,
      memory: 2048,
      minCapacity: 3,
      maxCapacity: 20,
      useFargateSpot: false,
    },
    database: {
      serverless: true,
      minCapacity: 2,
      maxCapacity: 64,
      multiAz: true,
      backupRetention: 35,
    },
    serverless: {
      memorySize: 1024,
      timeout: 30,
      reservedConcurrency: 100,
      retainData: true,
    },
  },
};
