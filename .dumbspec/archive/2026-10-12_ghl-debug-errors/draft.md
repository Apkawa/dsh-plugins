# 2026-10-12_ghl-debug-errors

/dumbspec для плагина dsh-ghl есть ряд замечаний, пока полностью проверить не удалось.
я тестирую в текущем репозитории
$ git remote -v
origin	git@github.com:Apkawa/dsh-plugins.git (fetch)
origin	git@github.com:Apkawa/dsh-plugins.git (push)

при открытии вкладки в сайдбаре пишется - No GitHub repository detected for this workspace

{"type":"server-response","rpcId":"3daa777f-4aa7-475a-84c3-b79743d2f882","result":{"ok":true,"value":{"repo":null}}}

Мне кажется нужно больше отладочных логов или вывод причины ошибки в апи, я нихуя не понимаю почему не работает, мне кажется что это из за того что мы ждем токен

2) на всякий случай хочу отметить что gh токен не обязателен, если его нет то использовать бесплатные лимиты, `curl https://api.github.com/repos/Apkawa/dsh-plugins/issues > .tmp/issues_list.txt`
3) ну иногда с бесплатными лимитами отдается ошибка если я использую vpn `{"message":"API rate limit exceeded for 104.28.196.105. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)","documentation_url":"https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting"}`, в общем её выводить вместо `No GitHub repository detected for this workspace` (хотя я отключил впн и оно все равно не помогло)

в общем я думаю что нужно более прозрачно показывать ошибки в интерфейсе вместо repo:null и отладочные логи (примеры логов в packages/dsh-model-settings)
