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

export interface AddDatadogToFargateTaskProps {
    // Note: it is important that the value specified by this secret
    // doesn't have a newline at the end. Otherwise, the firelens
    // logging configuration will fail to send logs to Datadog. This
    // is an easy mistake to introduce when the source for the secret
    // is a secretsmanager Secret containing a single value, rather
    // than key-value pairs.
    datadogApiKeySecret: ecs.Secret;
    // Defaults to datadoghq.com
    datadogSite?: string;
    agent?: {
        // Defaults to false
        enabled?: boolean;
        // Defaults to public.ecr.aws/datadog/agent:latest
        image?: ecs.ContainerImage;
        // Defaults to latest
        imageTag?: string;
        // Defaults to 256
        memoryLimitMiB?: number;
        // Defaults to unset
        cpu?: number;
        // Defaults to false
        logToCloudWatch?: boolean;
        apm?: {
            // Defaults to false
            enabled?: boolean;
            // Defaults to 8126
            port?: number;
            applicationEnvVars?: {
                // Defaults to false
                doNotSet?: boolean;
                // Defaults to DD_AGENT_HOST
                apmHostEnvVarName?: string;
                // Defaults to DD_TRACE_AGENT_PORT
                apmPortEnvVarName?: string;
                // Defaults to DD_TRACE_ENABLED
                apmTraceEnabledEnvVarName?: string;
            };
        };
        statsd?: {
            // Defaults to false
            enabled?: boolean;
            // Defaults to 8125
            port?: number;
            applicationEnvVars?: {
                // Defaults to false
                doNotSet?: boolean;
                // Defaults to STATSD_HOST
                statsdHostEnvVarName?: string;
                // Defaults to STATSD_PORT
                statsdPortEnvVarName?: string;
            };
        };
    };
    fireLensLogging?: {
        // Defaults to false
        enabled?: boolean;
        // Defaults to unset
        service?: string;
        // Defaults to unset
        source?: string;
        // Defaults to unset
        tags?: Record<string, string>;
        // Defaults to 256
        memoryLimitMiB?: number;
        // Defaults to unset
        cpu?: number;
        // Defaults to public.ecr.aws/datadog/aws-for-fluent-bit:latest
        image?: ecs.ContainerImage;
        // Defaults to latest
        imageTag?: string;
    };
}

const formatTags = (tags: Record<string, string>): string => {
    const formattedTags = [];
    for (const [key, value] of Object.entries(tags)) {
        formattedTags.push(`${key}:${value}`);
    }
    return formattedTags.join(',');
};

export const addDatadogToFargateTask = (task: ecs.TaskDefinition, props: AddDatadogToFargateTaskProps) => {
    const containerNames = [];
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const containers = task.containers;
    for (const container of containers) {
        containerNames.push(container.containerName);
    }

    if (props.agent?.enabled) {
        task.addContainer('datadog-agent', {
            image: props.agent?.image ?? ecs.ContainerImage.fromRegistry(`public.ecr.aws/datadog/agent:${props.agent?.imageTag ?? 'latest'}`),
            memoryLimitMiB: props.agent?.memoryLimitMiB ?? 256,
            ...(props.agent?.cpu
                ? {
                      cpu: props.fireLensLogging?.cpu,
                  }
                : {}),
            ...(props.agent?.logToCloudWatch
                ? {
                      logging: ecs.LogDrivers.awsLogs({
                          streamPrefix: 'datadog-agent',
                      }),
                  }
                : {}),
            environment: {
                ECS_FARGATE: 'true',
                DD_SITE: props.datadogSite ?? 'datadoghq.com',
                ...(props.agent?.apm?.enabled
                    ? {
                          DD_APM_ENABLED: 'true',
                          DD_APM_RECEIVER_PORT: String(props.agent?.apm?.port ?? '8126'),
                      }
                    : {
                          DD_APM_ENABLED: 'false',
                      }),
                ...(props.agent?.statsd?.enabled
                    ? {
                          DD_USE_DOGSTATSD: 'true',
                          DD_DOGSTATSD_PORT: String(props.agent?.statsd?.port ?? '8125'),
                      }
                    : {
                          DD_USE_DOGSTATSD: 'false',
                      }),
            },
            secrets: {
                DD_API_KEY: props.datadogApiKeySecret,
            },
        });

        if (props.agent?.apm?.enabled && props.agent?.apm?.applicationEnvVars?.doNotSet !== true) {
            for (const containerName of containerNames) {
                const container = task.findContainer(containerName);
                if (container) {
                    container.addEnvironment(props.agent?.apm.applicationEnvVars?.apmTraceEnabledEnvVarName ?? 'DD_TRACE_ENABLED', 'true');
                    container.addEnvironment(props.agent?.apm.applicationEnvVars?.apmHostEnvVarName ?? 'DD_AGENT_HOST', 'localhost');
                    container.addEnvironment(props.agent?.apm.applicationEnvVars?.apmPortEnvVarName ?? 'DD_TRACE_AGENT_PORT', String(props.agent?.apm?.port ?? '8126'));
                }
            }
        }

        if (props.agent?.statsd?.enabled && props.agent?.statsd?.applicationEnvVars?.doNotSet !== true) {
            for (const containerName of containerNames) {
                const container = task.findContainer(containerName);
                if (container) {
                    container.addEnvironment(props.agent?.statsd?.applicationEnvVars?.statsdHostEnvVarName ?? 'STATSD_HOST', 'localhost');
                    container.addEnvironment(props.agent?.statsd?.applicationEnvVars?.statsdPortEnvVarName ?? 'STATSD_PORT', String(props.agent?.statsd?.port ?? '8125'));
                }
            }
        }
    }

    if (props.fireLensLogging?.enabled) {
        task.addFirelensLogRouter('log_router', {
            image: props.fireLensLogging?.image ?? ecs.ContainerImage.fromRegistry(`public.ecr.aws/datadog/aws-for-fluent-bit:${props.fireLensLogging?.imageTag ?? 'latest'}`),
            memoryLimitMiB: props.fireLensLogging?.memoryLimitMiB ?? 256,
            ...(props.fireLensLogging?.cpu
                ? {
                      cpu: props.fireLensLogging?.cpu,
                  }
                : {}),
            firelensConfig: {
                type: ecs.FirelensLogRouterType.FLUENTBIT,
                options: {
                    enableECSLogMetadata: true,
                },
            },
        });

        const firelensLogDriver = ecs.LogDrivers.firelens({
            options: {
                Name: 'datadog',
                Host: `http-intake.logs.${props.datadogSite ?? 'datadoghq.com'}`,
                TLS: 'on',
                provider: 'ecs',
                dd_message_key: 'log',
                ...(props.fireLensLogging?.service
                    ? {
                          dd_service: props.fireLensLogging?.service,
                      }
                    : {}),
                ...(props.fireLensLogging?.source
                    ? {
                          dd_source: props.fireLensLogging?.source,
                      }
                    : {}),
                ...(props.fireLensLogging?.tags
                    ? {
                          dd_tags: formatTags(props.fireLensLogging?.tags),
                      }
                    : {}),
            },
            secretOptions: {
                apikey: props.datadogApiKeySecret,
            },
        });

        for (const containerName of containerNames) {
            const container = task.findContainer(containerName);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            container.logDriverConfig = firelensLogDriver.bind(container, container);
        }
    }
};
