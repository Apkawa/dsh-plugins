# GitHub REST API — краткое описание (основной фокус: issues)

Базовый URL: `https://api.github.com`. Все запросы — JSON; для аутентификации
используйте токен: заголовок `Authorization: Bearer <TOKEN>` (ранее поддерживался
формат `token <TOKEN>`).

Развёрнутая документация:

- [Overview — GitHub REST API](https://docs.github.com/en/rest)
- [Issues](https://docs.github.com/en/rest/issues/issues)
- [Issue comments](https://docs.github.com/en/rest/issues/comments)
- [Labels](https://docs.github.com/en/rest/issues/labels)
- [Timeline](https://docs.github.com/en/rest/issues/timeline)
- [Authentication](https://docs.github.com/en/rest/authentication)
- [Rate limits](https://docs.github.com/en/rest/overview/rate-limits-for-the-github-api)

## Issues

| Метод | Путь | Описание |
| --- | --- | --- |
| `GET` | `/issues` | Список issues по всем репозиториям, за которые вы подписаны (можно фильтровать `state`, `labels`, `sort` и т.д.) |
| `GET` | `/repos/{owner}/{repo}/issues` | Список issues конкретного репозитория |
| `GET` | `/repos/{owner}/{repo}/issues/{issue_number}` | Получить issue по номеру |
| `POST` | `/repos/{owner}/{repo}/issues` | Создать issue (`title`, `body`, `assignees`, `labels`) |
| `PATCH` | `/repos/{owner}/{repo}/issues/{issue_number}` | Обновить issue (статус, title, labels и др.) |
| `DELETE` | `/repos/{owner}/{repo}/issues/{issue_number}` | *(нет — issues нельзя удалить через API, только закрыть)* |
| `GET` | `/repos/{owner}/{repo}/issues/{issue_number}/events` | История событий по issue |
| `GET` | `/repos/{owner}/{repo}/issues/{issue_number}/timeline` | Timeline issue |
| `POST` | `/repos/{owner}/{repo}/issues/{issue_number}/labels` | Добавить label(s) к issue |
| `DELETE` | `/repos/{owner}/{repo}/issues/{issue_number}/labels/{label}` | Убрать label с issue |

> `issue_number` — это **номер** issue (не `id`).

## Issue comments

| Метод | Путь | Описание |
| --- | --- | --- |
| `GET` | `/repos/{owner}/{repo}/issues/{issue_number}/comments` | Список комментариев к issue |
| `GET` | `/repos/{owner}/{repo}/issues/comments/{comment_id}` | Получить конкретный комментарий |
| `POST` | `/repos/{owner}/{repo}/issues/{issue_number}/comments` | Создать комментарий (`body`) |
| `PATCH` | `/repos/{owner}/{repo}/issues/comments/{comment_id}` | Обновить комментарий |
| `DELETE` | `/repos/{owner}/{repo}/issues/comments/{comment_id}` | Удалить комментарий |

## Labels (на уровне репозитория)

| Метод | Путь | Описание |
| --- | --- | --- |
| `GET` | `/repos/{owner}/{repo}/labels` | Все labels репозитория |
| `GET` | `/repos/{owner}/{repo}/labels/{name}` | Конкретный label |
| `POST` | `/repos/{owner}/{repo}/labels` | Создать label (`name`, `color`) |
| `PATCH` | `/repos/{owner}/{repo}/labels/{name}` | Обновить label |
| `DELETE` | `/repos/{owner}/{repo}/labels/{name}` | Удалить label |

## Поиск issues

| Метод | Путь | Описание |
| --- | --- | --- |
| `GET` | `/search/issues` | Поиск по issues/PRs через поисковый запрос `q` (поддерживает `is:issue`, `is:pr`, `repo:`, `label:`, `state:` и другие qualifiers) |

Пример:
```
GET /search/issues?q=repo:octocat/Hello-World+is:issue+state:open+label:bug
```

## Rate limits

- **60 запросов/час** для неавторизованных клиентов.
- **5000 запросов/час** для авторизованных (token / OAuth).
- Заголовок `X-RateLimit-Remaining` показывает остаток; `X-RateLimit-Reset` — Unix-время сброса.
- Ответ `403`/`429` + заголовок `Retry-After` — rate limit исчерпан, нужно подождать.

## Типовые query-параметры для списков

- `state` — `open` / `closed` / `all`
- `sort` — `created` / `updated` / `comments`
- `direction` — `asc` / `desc`
- `per_page` — до 100
- `page` — пагинация (1-based)

## Ссылки на развёрнутую документацию

- [REST API reference](https://docs.github.com/en/rest)
- [Issues](https://docs.github.com/en/rest/issues/issues)
- [Issue comments](https://docs.github.com/en/rest/issues/comments)
- [Labels](https://docs.github.com/en/rest/issues/labels)
- [Timeline](https://docs.github.com/en/rest/issues/timeline)
- [Search](https://docs.github.com/en/rest/search/search)
- [Authentication](https://docs.github.com/en/rest/authentication)
- [Rate limits](https://docs.github.com/en/rest/overview/rate-limits-for-the-github-api)
