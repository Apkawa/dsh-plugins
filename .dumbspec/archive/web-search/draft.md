сделать tool по типу текущего веб поиска которое использует дикпик апи, но используя https://github.com/deedy5/ddgs

в packages/dsh-web-search-ddgs


для начала сделать максимально просто, при возможности используя uvx для ddgs

`uvx ddgs text -b yandex -q "Последняя версия react"`

Единственная проблема сейчас - у меня ограничен интернет белым списком, и я надеялся тестировать на ya.ru, но там ошибка 

```
$ uvx ddgs text -b yandex -q "Последняя версия react"
WARNING:ddgs.ddgs:yandex - backends do not exist or are disabled. Available: brave, duckduckgo, google, grokipedia, mojeek, startpage, wikipedia, yahoo
WARNING:ddgs.ddgs:backend is not set. Using 'auto'
```

Т.е. предлагаю 
1) скачать пакет ddgs (зеркала у pip и pypi настроены)
2) исследовать как все внутри работает, может получится починить яндекс
3) накидать mvp плагина, беря за образец инструмент из dsh

p.s. если в бекенде для поиска нужен ключ апи - исключаем.
если с интернетом совсем плохо - ограничивайся пп3, пусть поиск будет сломаным пока.
