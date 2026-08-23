# dsh-model-settings plugin

Плагин для deepseek-harness



Меня раздражает когда при получении списка моделей из llama.cpp не подцепляем автоматически установленный размер контекста.
+ нет возможности выставить семплеры, размер мышления и в особенности температуру, например я захочу использовать одну и ту же модель в апи, но с разной температуры для планирования и написания кода, т.е. с разными алиасами.

вот в апи llama.cpp есть настройки модели
пример:

`GET http://192.168.1.111:8080/props?model=gemma-3-12b-it-abliterated-q4_k_m&autoload=false`


200 OK

```json
{
  "default_generation_settings": {
    "params": {
      "seed": 4294967295,
      "temperature": 0.699999988079071,
      "dynatemp_range": 0.0,
      "dynatemp_exponent": 1.0,
      "top_k": 20,
      "top_p": 0.800000011920929,
      "min_p": 0.0,
      "top_n_sigma": -1.0,
      "xtc_probability": 0.0,
      "xtc_threshold": 0.10000000149011612,
      "typical_p": 1.0,
      "repeat_last_n": 64,
      "repeat_penalty": 1.0,
      "presence_penalty": 1.5,
      "frequency_penalty": 0.0,
      "dry_multiplier": 0.0,
      "dry_base": 1.75,
      "dry_allowed_length": 2,
      "dry_penalty_last_n": 64,
      "mirostat": 0,
      "mirostat_tau": 5.0,
      "mirostat_eta": 0.10000000149011612,
      "adaptive_target": -1.0,
      "adaptive_decay": 0.8999999761581421,
      "max_tokens": -1,
      "n_predict": -1,
      "n_keep": 0,
      "n_discard": 0,
      "ignore_eos": false,
      "stream": false,
      "n_probs": 0,
      "min_keep": 0,
      "chat_format": "Content-only",
      "reasoning_format": "none",
      "reasoning_in_content": false,
      "generation_prompt": "",
      "samplers": [
        "penalties",
        "dry",
        "top_n_sigma",
        "top_k",
        "typ_p",
        "top_p",
        "min_p",
        "xtc",
        "temperature"
      ],
      "speculative.types": "none",
      "timings_per_token": false,
      "post_sampling_probs": false,
      "backend_sampling": false,
      "lora": []
    },
    "n_ctx": 120064
  },
  "total_slots": 4,
  "model_alias": "empero-ai_Qwen3.8-27B-Ridge-3.7bpw",
  "model_ftype": "IQ2_M - 2.7 bpw",
  "model_path": "Qwen3.8/empero-ai_Qwen3.8-27B-Ridge-3.7bpw.gguf",
  "modalities": { "vision": false, "video": false, "audio": false },
  "media_marker": "<__media_NkXfof7MFimkrNlKLYAlywvCJ9KcRY2Q__>",
  "endpoint_slots": true,
  "endpoint_props": false,
  "endpoint_metrics": false,
  "ui": true,
  "ui_settings": {},
  "chat_template": "...",
  "chat_template_caps": {
    "supports_object_arguments": true,
    "supports_parallel_tool_calls": true,
    "supports_preserve_reasoning": true,
    "supports_reasoning_effort": true,
    "supports_string_content": true,
    "supports_system_role": true,
    "supports_tool_calls": true,
    "supports_tools": true,
    "supports_typed_content": false
  },
  "bos_token": "<|endoftext|>",
  "eos_token": "<|im_end|>",
  "build_info": "b10486-7acdbb1f1",
  "is_sleeping": false,
  "cors_proxy_enabled": false
}
```

Что используем и потом меняем вручную:
1) "n_ctx": 120064 - размер контекста, округлим в меньшую сторону до 120К. ну т.е. 10К, 25К и тд, тысячи обнуляем, 21345 -> 21000
2) семплеры, такие как (кусок конфига llama.cpp):
```
temp = 1.0
top-p=0.95
top-k=20
min-p=0
presence-penalty=0.0
repeat-penalty=1.0
```

на самом деле их бывает больше, но для котинга используются такие
3) modalities, тоже подцепить из апи
4) reasoning_effort, это хардкод и в апи настрек модели я не вижу откуда подцепить. по умолчанию ничего не передаем как сейчас используется
но можем выбрать из default, max, xhigh, high, medium, low, off или числовое значение бюджета токенов размышления. 
Тема довольно глубокая поэтому сделаем пока как можно проще и в последнюю очередь

в `http://192.168.1.69:8080/v1/chat/completions`

передается как часть жсона
```json
{
...
"thinking_budget_tokens": 2048,
"chat_template_kwargs": {
  "enable_thinking": true,// (если false - то off)
  "reasoning_effort": "medium",// алиас объема размышления которая прокидывается в шаблон
} 
}
```


## Зависимости

изучаем `dsh/` (это симлинк deepseek-harness для изучения) и делаем по гайдлайну

* typescript
* node>=24
* pnpm
* react (в плагинах и интерфейсе вроде он используется)
