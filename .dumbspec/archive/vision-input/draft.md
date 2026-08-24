# draft

Сырой ввод пользователя (2026-07-14):

> /dumbspec
> examples/tmp/dsh-docs/user/guide/providers.md
>
> 1) добавить в наш интерфейс настроек чекбокс того что модель поддерживает vision. это добавляет в настройки модели `input: [text, image]` (text  в поле всегда должно быть) (примерно по аналогии как сейчас делаем с effort)
> 2) при добавлении модели подтянуть из llama.cpp то что модель настроена как вижен по полю в  /v1/models:
> data[0].architecture.input_modalities
> ```json
> architecture:  {input_modalities: ["text", "image"], output_modalities: ["text"]}
> ```
> По идее вопросов не должно быть, делай автономно
