import { Construct } from 'constructs';

import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface EcsDatadogDaemonServiceProps {
    readonly ecsCluster: ecs.Cluster;
    readonly datadogApiKeySecret: secretsmanager.ISecret;
    readonly datadogSite?: string;
    readonly logsDisabled?: boolean;
}

export class EcsDatadogDaemonService extends Construct {
    constructor(scope: Construct, id: string, props: EcsDatadogDaemonServiceProps) {
        super(scope, id);

        // To match as documented at
        // https://docs.datadoghq.com/containers/amazon_ecs/?tab=awscli#setup
        // and
        // https://docs.datadoghq.com/containers/amazon_ecs/logs/?tab=linux
        const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TaskDefinition', {
            family: 'datadog-agent-task',
        });

        const container = taskDefinition.addContainer('datadog-agent', {
            image: ecs.ContainerImage.fromRegistry('public.ecr.aws/datadog/agent:latest'),
            cpu: 100,
            memoryLimitMiB: 512,
            essential: true,
            environment: {
                DD_SITE: props.datadogSite ?? 'datadoghq.com',
                ...(props.logsDisabled
                    ? {}
                    : {
                          DD_LOGS_ENABLED: 'true',
                          DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL: 'true',
                      }),
            },
            secrets: {
                DD_API_KEY: ecs.Secret.fromSecretsManager(props.datadogApiKeySecret),
            },
            healthCheck: {
                command: ['CMD-SHELL', 'agent health'],
                retries: 3,
                timeout: cdk.Duration.seconds(5),
                interval: cdk.Duration.seconds(10),
                startPeriod: cdk.Duration.seconds(15),
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'datadog-agent',
            }),
        });

        container.addMountPoints(
            {
                containerPath: '/var/run/docker.sock',
                sourceVolume: 'docker_sock',
                readOnly: true,
            },
            {
                containerPath: '/host/sys/fs/cgroup',
                sourceVolume: 'cgroup',
                readOnly: true,
            },
            {
                containerPath: '/host/proc',
                sourceVolume: 'proc',
                readOnly: true,
            },
        );

        if (!props.logsDisabled) {
            container.addMountPoints(
                {
                    containerPath: '/opt/datadog-agent/run',
                    sourceVolume: 'pointdir',
                    readOnly: false,
                },
                {
                    containerPath: '/var/lib/docker/containers',
                    sourceVolume: 'containers_root',
                    readOnly: true,
                },
            );
        }

        taskDefinition.addVolume({
            name: 'docker_sock',
            host: {
                sourcePath: '/var/run/docker.sock',
            },
        });

        taskDefinition.addVolume({
            name: 'proc',
            host: {
                sourcePath: '/proc/',
            },
        });

        taskDefinition.addVolume({
            name: 'cgroup',
            host: {
                sourcePath: '/sys/fs/cgroup/',
            },
        });

        if (!props.logsDisabled) {
            taskDefinition.addVolume({
                name: 'pointdir',
                host: {
                    sourcePath: '/opt/datadog-agent/run',
                },
            });

            taskDefinition.addVolume({
                name: 'containers_root',
                host: {
                    sourcePath: '/var/lib/docker/containers',
                },
            });
        }

        new ecs.Ec2Service(this, 'Service', {
            cluster: props.ecsCluster,
            taskDefinition,
            daemon: true,
        });
    }
}