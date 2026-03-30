#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { EksStack } from '../lib/eks-stack';
import { EcrStack } from '../lib/ecr-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

const networkStack = new NetworkStack(app, 'NetworkStack');

const ecrStack = new EcrStack(app, 'EcrStack');

const eksStack = new EksStack(app, 'EksStack', {
  vpc: networkStack.vpc,
  env: networkStack.env,
});

new PipelineStack(app, 'PipelineStack', {
  vpc: networkStack.vpc,
  env: networkStack.env,
});

eksStack.addDependency(networkStack);
