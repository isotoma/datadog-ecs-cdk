# datadog-ecs-cdk

Docs: https://isotoma.github.io/datadog-ecs-cdk/

NPM: https://www.npmjs.com/package/datadog-ecs-cdk

Source: https://github.com/isotoma/datadog-ecs-cdk

## EC2 example

```typescript
import { EcsDatadogDaemonService } from 'datadog-ecs-cdk';

// ...

new EcsDatadogDaemonService(this, 'EcsDatadog', {
    ecsCluster: myCluster,
    datadogApiKeySecret: mySecret,
});
```

## Fargate example
```typescript
import { addDatadogToFargateTask } from 'datadog-ecs-cdk';

// ...

const myTaskDef = ...

addDatadogToFargateTask(myTaskDef, {
    datadogApiKeySecret: ecs.Secret.fromSecretsManager(mySecret),
    agent: {
        enabled: true,
        statsd: {
            enabled: true,
        },
    },
    fireLensLogging: {
        enabled: true,
        service: 'myservice',
        source: 'myservice',
    },
});
```
