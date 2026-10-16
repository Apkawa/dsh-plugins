# Draft — 2026-10-16_pnpm-catalog

Вынести зависимости в `catalog:`
На примере react:
1) в pnpm-workspace.json
```
catalog:
  react: ~18.2.0
```
2) В packages/dsh-model-settings/package.json
вместо `"react": "^18.2.0",`
используем
    `"react": "catalog:",`


Фактически все peer и dev зависимости  которые везде дублируются и не привязаны к конкретному плагину то надо вынести в catalog. Это мы делаем для всех плагинов

Немного документации по pnpm catalogs 
https://raw.githubusercontent.com/pnpm/pnpm/refs/heads/main/pnpm/docs/catalogs.md
