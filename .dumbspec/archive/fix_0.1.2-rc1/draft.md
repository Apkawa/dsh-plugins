1) Вот такая ошибка возникает сейчас на ветке 0.1.2-rc.1
```
failed to import loader entry 65fa33dc (@apkawa/dsh-model-settings): client-modules: require("@deepseek-ai/dsh-client-runtime/client") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)
```

восстановить помогает удаление сломаных плагинов из ~/.dsh/profiles/web/package.json

(если dsh после этого вообще не запускается - то надо удалить ~/.dsh/profies/web/)
