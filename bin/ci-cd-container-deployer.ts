#!/usr/bin/env node
import 'source-map-support/register';
import * as dotenv from 'dotenv';
import * as cdk from 'aws-cdk-lib';

dotenv.config();
import { NetworkStack } from '../lib/network-stack';
import { EksStack } from '../lib/eks-stack';
import { EcrStack } from '../lib/ecr-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const networkStack = new NetworkStack(app, 'NetworkStack', { env });

const ecrStack = new EcrStack(app, 'EcrStack', { env });

const eksStack = new EksStack(app, 'EksStack', {
  vpc: networkStack.vpc,
  env,
});
eksStack.addDependency(networkStack);

const pipelineStack = new PipelineStack(app, 'PipelineStack', {
  vpc: networkStack.vpc,
  env,
  ecrRepositoryUri: ecrStack.repositoryUri,
  eksClusterName: eksStack.cluster.clusterName,
  githubConnectionArn: process.env.GITHUB_CONNECTION_ARN || '',
  githubOwner: process.env.GITHUB_OWNER || '',
  githubRepo: process.env.GITHUB_REPO || '',
});
pipelineStack.addDependency(networkStack);
pipelineStack.addDependency(ecrStack);
pipelineStack.addDependency(eksStack);
