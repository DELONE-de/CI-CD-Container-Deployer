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

    // AWS Load Balancer Controller for ALB/NLB in public subnets
    const albServiceAccount = this.cluster.addServiceAccount('ALBServiceAccount', {
      name: 'aws-load-balancer-controller',
      namespace: 'kube-system',
    });

    albServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:CreateServiceLinkedRole',
        'ec2:DescribeAccountAttributes',
        'ec2:DescribeAddresses',
        'ec2:DescribeAvailabilityZones',
        'ec2:DescribeInternetGateways',
        'ec2:DescribeVpcs',
        'ec2:DescribeVpcPeeringConnections',
        'ec2:DescribeSubnets',
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeInstances',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeTags',
        'ec2:GetCoipPoolUsage',
        'ec2:DescribeCoipPools',
        'elasticloadbalancing:DescribeLoadBalancers',
        'elasticloadbalancing:DescribeLoadBalancerAttributes',
        'elasticloadbalancing:DescribeListeners',
        'elasticloadbalancing:DescribeListenerCertificates',
        'elasticloadbalancing:DescribeSSLPolicies',
        'elasticloadbalancing:DescribeRules',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:DescribeTargetGroupAttributes',
        'elasticloadbalancing:DescribeTargetHealth',
        'elasticloadbalancing:DescribeTags',
      ],
      resources: ['*'],
    }));

    albServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:DescribeUserPoolClient',
        'acm:ListCertificates',
        'acm:DescribeCertificate',
        'iam:ListServerCertificates',
        'iam:GetServerCertificate',
        'waf-regional:GetWebACL',
        'waf-regional:GetWebACLForResource',
        'waf-regional:AssociateWebACL',
        'waf-regional:DisassociateWebACL',
        'wafv2:GetWebACL',
        'wafv2:GetWebACLForResource',
        'wafv2:AssociateWebACL',
        'wafv2:DisassociateWebACL',
        'shield:GetSubscriptionState',
        'shield:DescribeProtection',
        'shield:CreateProtection',
        'shield:DeleteProtection',
      ],
      resources: ['*'],
    }));

    albServiceAccount.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:AuthorizeSecurityGroupIngress',
        'ec2:RevokeSecurityGroupIngress',
        'ec2:CreateSecurityGroup',
        'ec2:CreateTags',
        'ec2:DeleteTags',
        'ec2:DeleteSecurityGroup',
        'elasticloadbalancing:CreateLoadBalancer',
        'elasticloadbalancing:CreateTargetGroup',
        'elasticloadbalancing:CreateListener',
        'elasticloadbalancing:DeleteListener',
        'elasticloadbalancing:CreateRule',
        'elasticloadbalancing:DeleteRule',
        'elasticloadbalancing:AddTags',
        'elasticloadbalancing:RemoveTags',
        'elasticloadbalancing:ModifyLoadBalancerAttributes',
        'elasticloadbalancing:SetIpAddressType',
        'elasticloadbalancing:SetSecurityGroups',
        'elasticloadbalancing:SetSubnets',
        'elasticloadbalancing:DeleteLoadBalancer',
        'elasticloadbalancing:ModifyTargetGroup',
        'elasticloadbalancing:ModifyTargetGroupAttributes',
        'elasticloadbalancing:DeleteTargetGroup',
        'elasticloadbalancing:RegisterTargets',
        'elasticloadbalancing:DeregisterTargets',
        'elasticloadbalancing:SetWebAcl',
        'elasticloadbalancing:ModifyListener',
        'elasticloadbalancing:AddListenerCertificates',
        'elasticloadbalancing:RemoveListenerCertificates',
        'elasticloadbalancing:ModifyRule',
      ],
      resources: ['*'],
    }));

    this.cluster.addHelmChart('AWSLoadBalancerController', {
      chart: 'aws-load-balancer-controller',
      repository: 'https://aws.github.io/eks-charts',
      namespace: 'kube-system',
      values: {
        clusterName: this.cluster.clusterName,
        serviceAccount: {
          create: false,
          name: 'aws-load-balancer-controller',
        },
      },
    });

    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'OidcIssuer', { value: this.cluster.clusterOpenIdConnectIssuerUrl });
  }
}
