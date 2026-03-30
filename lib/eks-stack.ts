import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { KubectlV29Layer } from '@aws-cdk/lambda-layer-kubectl-v29';
import { Construct } from 'constructs';

export interface EksStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class EksStack extends cdk.Stack {
  public readonly cluster: eks.Cluster;

  constructor(scope: Construct, id: string, props: EksStackProps) {
    super(scope, id, props);

    // IAM role for the EKS cluster control plane
    const clusterRole = new iam.Role(this, 'ClusterRole', {
      assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
      ],
    });

    // EKS cluster in private subnets; ALB will use public subnets via subnet selection
    this.cluster = new eks.Cluster(this, 'AppCluster', {
      clusterName: 'app-eks-cluster',
      version: eks.KubernetesVersion.V1_29,
      kubectlLayer: new KubectlV29Layer(this, 'KubectlLayer'),
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      defaultCapacity: 0, // managed via node group below
      role: clusterRole,
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
    });

    // Node group in private subnets for running containers
    this.cluster.addNodegroupCapacity('AppNodeGroup', {
      instanceTypes: [new ec2.InstanceType('t3.medium')],
      minSize: 1,
      desiredSize: 2,
      maxSize: 4,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      nodeRole: new iam.Role(this, 'NodeGroupRole', {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
        ],
      }),
    });

    // OIDC provider is automatically created by eks.Cluster (openIdConnectProvider)
    // Expose it for downstream IAM role bindings (IRSA)
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'OidcIssuer', { value: this.cluster.clusterOpenIdConnectIssuerUrl });
  }
}
