# Draft

1) добавляется `packages/utils`  чисто для общего кода

2)  в `packages/utils/log.ts` логгер классом который используется в качестве синглтона и принимает в качестве аргумента ns
пример использования
```ts
const logger = new Log('model-settings')
logger.debug("foo") // DEBUG [model-settings] foo
const subLogger = logger.newLog('core') 
subLogger.info("bar") // INFO [model-settings/core] bar
```

3) у остальных плагинов переделать на использование логов из utils/log

Дополнение пользователя: сейчас в плагинах одна и та же копипаста — `packages/dsh-ghl/src/log.ts`.
