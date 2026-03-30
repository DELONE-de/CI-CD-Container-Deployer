import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { Construct } from 'constructs';

export interface PipelineStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  ecrRepositoryUri: string;
  eksClusterName: string;
  githubConnectionArn: string;
  githubOwner: string;
  githubRepo: string;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    
    if (!props.githubConnectionArn || !props.githubOwner || !props.githubRepo) {
      throw new Error('Missing required GitHub configuration: GITHUB_CONNECTION_ARN, GITHUB_OWNER, and GITHUB_REPO must be set');
    }

    const region = this.region;

    const accountId = this.account;

    // IAM role for CodeBuild
    const codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      inlinePolicies: {
        EcrAccess: new iam.PolicyDocument({
          statements: [
            // ecr:GetAuthorizationToken is global, cannot be scoped to a resource
            new iam.PolicyStatement({
              actions: ['ecr:GetAuthorizationToken'],
              resources: ['*'],
            }),
            new iam.PolicyStatement({
              actions: [
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage',
                'ecr:InitiateLayerUpload',
                'ecr:UploadLayerPart',
                'ecr:CompleteLayerUpload',
                'ecr:PutImage',
              ],
              resources: [`arn:aws:ecr:${region}:${accountId}:repository/*`],
            }),
            new iam.PolicyStatement({
              actions: ['eks:DescribeCluster'],
              resources: [`arn:aws:eks:${region}:${accountId}:cluster/${props.eksClusterName}`],
            }),
            new iam.PolicyStatement({
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: [`arn:aws:logs:${region}:${accountId}:log-group:/aws/codebuild/*`],
            }),
          ],
        }),
      },
    });

    // CodeBuild project
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      role: codeBuildRole,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        environmentVariables: {
          ECR_REPO_URI: { value: props.ecrRepositoryUri },
          ECR_REGISTRY: { value: props.ecrRepositoryUri.split('/')[0] },
          CLUSTER_NAME: { value: props.eksClusterName },
          REGION: { value: region },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"',
              'chmod +x kubectl && mv kubectl /usr/local/bin/',
              'kubectl version --client',
            ],
          },
          pre_build: {
            commands: [
              'aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REGISTRY',
              'export IMAGE_TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c1-7)',
              'export IMAGE_URI=$ECR_REPO_URI:$IMAGE_TAG',
            ],
          },
          build: {
            commands: [
              'docker build -t $IMAGE_URI services/ci-cd-app',
            ],
          },
          post_build: {
            commands: [
              'docker push $IMAGE_URI',
              'aws eks update-kubeconfig --region $REGION --name $CLUSTER_NAME',
              'kubectl apply -f k8s/',
              'kubectl set image deployment/ci-cd-app ci-cd-app=$IMAGE_URI',
              'kubectl rollout status deployment/ci-cd-app || (kubectl rollout undo deployment/ci-cd-app && exit 1)',
              'kubectl get pods',
              'kubectl get svc',
            ],
          },
        },
      }),
      vpc: props.vpc,
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // CodePipeline source from GitHub via CodeStar Connection
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    // CodePipeline
    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'CI-CD-Container-Deployer',
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.CodeStarConnectionsSourceAction({
              actionName: 'Source',
              connectionArn: props.githubConnectionArn,
              owner: props.githubOwner,
              repo: props.githubRepo,
              branch: 'main',
              output: sourceOutput,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'Build',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
      ],
    });
  }
}
