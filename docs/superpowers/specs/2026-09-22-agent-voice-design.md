# agent-voice — notificação por voz para agentes de código

**Data:** 2026-09-22
**Status:** aprovado, aguardando plano de implementação

## Problema

Hoje existe um único script, `~/bin/claude-alexa-notify.sh` (187 linhas), que faz
tudo de uma vez: lê o formato nativo dos hooks do Claude Code, guarda estado por
sessão, decide se vale falar, monta a frase e chama o Home Assistant.

Funciona, mas as regras de decisão (limiar de duração, cooldown, limpeza de texto
para fala) estão soldadas ao formato de entrada do Claude Code. Acoplar um segundo
agente — Codex, por exemplo — exigiria copiar o script e ajustar, e a partir daí as
regras divergem: um corrige um bug de pontuação que o outro não tem.

## Objetivo

Um repositório onde acoplar um agente novo custe **um tradutor**, e nada mais.

### Não-objetivos

Deliberadamente fora deste escopo:

- **Adaptador do Codex.** Ele não está instalado nesta máquina. O encaixe fica
  pronto e documentado; o código, não. Construir um tradutor para um formato que
  ninguém observou é adivinhação.
- **Outros canais de saída** (toast do Windows, Slack). O núcleo despacha para uma
  lista de outputs, mas só `alexa` existe.
- **Absorver o cron de prioridades** (`~/bin/prioridades-diarias.sh`). Ele funciona
  e tem três canais próprios. Migrá-lo é outro trabalho, com seu próprio risco.

## Arquitetura

```
hook do Claude ──┐
                 ├──> adapters/<agente>.sh ──> evento canônico ──> lib/core.sh ──> outputs/alexa.sh
log do Codex ────┘        (traduz)                  (JSON)          (decide)         (fala)
```

A fronteira é o **evento canônico**. Acima dela, cada agente é estranho e
imprevisível. Abaixo, tudo é igual.

### Estrutura de arquivos

```
agent-voice/
  bin/notify                  ponto de entrada único
  lib/core.sh                 filtra, monta a frase, despacha
  lib/state.sh                estado por sessão (início de turno, cooldown, payload)
  lib/fala.sh                 limpeza de texto para voz
  lib/log.sh                  registro durável de cada disparo
  adapters/claude-code.sh     traduz os hooks do Claude Code
  adapters/CONTRATO.md        como escrever um adaptador novo
  outputs/alexa.sh            chama o falar.sh do repo home-assistant
  test/run.sh                 testes de regressão, saída stubada
  config.sh                   limiares e caminhos
```

### O evento canônico

Produzido pelo adaptador no stdout, consumido pelo núcleo no stdin.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `tipo` | enum | sim | `inicio_turno`, `fim_tarefa`, `fim_background`, `precisa_input` |
| `agente` | string | sim | `claude-code`, `codex`, … |
| `sessao_id` | string | sim | Identidade estável; vira chave de estado em disco |
| `sessao_nome` | string | não | Nome legível, para a fala. Sem ele, o núcleo usa um rótulo derivado do id |
| `projeto` | string | não | Diretório de trabalho, só o último segmento |
| `texto` | string | não | O que foi pedido, ou a mensagem do agente |

O evento **não** carrega `duracao`. O adaptador não sabe quanto durou o turno, e
perguntar isso a ele exigiria dar-lhe acesso ao estado. Quem calcula é o núcleo,
comparando com o `inicio_turno` que guardou.

Exemplo:

```json
{ "tipo": "fim_tarefa",
  "agente": "claude-code",
  "sessao_id": "04c02385-aa50-4bd0-9a13-fc326e1f3f24",
  "sessao_nome": "Home assistant repo",
  "projeto": "home-assistant",
  "texto": "conectar a alexa aos hooks de sessao" }
```

## Componentes

### `bin/notify`

```
notify <agente> <subcomando> [args]     # JSON nativo no stdin
```

Resolve `adapters/<agente>.sh`, passa o stdin adiante, e entrega o evento
resultante ao núcleo. Se o adaptador não existir ou não emitir evento, registra e
sai 0 — nunca derruba quem chamou.

Depende de: adaptadores, `lib/core.sh`.

### `adapters/<agente>.sh`

Recebe o subcomando e o payload nativo. Emite um evento canônico no stdout.
**Não decide nada e não guarda nada** — nem se vale falar, nem o que falar, nem o
que aconteceu no turno anterior.

Um adaptador é uma função pura do payload nativo para o evento. É o que torna
barato acoplar um agente novo: nada de estado para entender, nada de regra para
replicar. O que é específico do agente fica aqui — para o Claude Code, descobrir o
`sessao_nome` lendo o `aiTitle` do transcript.

Depende de: nada além de `jq`.

### `lib/core.sh`

Onde ficam todas as regras de decisão.

Antes de tudo, o núcleo completa o evento: em `inicio_turno` guarda hora e `texto` e
encerra sem falar; em `fim_tarefa` recupera os dois e calcula a duração. O adaptador
entregou só o que sabia. Depois:

1. **Filtro por tipo.** `fim_tarefa` com duração abaixo do limiar → silêncio.
   `fim_background` dentro do cooldown → silêncio. `precisa_input` nunca é filtrado.
2. **Montagem da frase**, um template por tipo.
3. **Despacho** para cada output.

Toda decisão silenciosa é registrada com o motivo. Um hook que fica quieto e um
hook que morreu são indistinguíveis sem isso — foi um erro real de diagnóstico
durante o desenvolvimento do script atual.

### `lib/state.sh`

Usado **apenas pelo núcleo**. Estado em
`~/.local/state/agent-voice/<agente>/<sessao_id>.*`, chaveado por sessão, então
sessões simultâneas não se atropelam. Marcas de turno são efêmeras: criadas no
`inicio_turno`, apagadas no `fim_tarefa`.

### `lib/log.sh`

Uma linha por disparo em `~/.local/state/agent-voice/eventos.log`: data, agente,
sessão, e o que aconteceu — falou, ficou em silêncio e por quê, ou falhou.

### `outputs/alexa.sh`

Recebe a frase pronta no stdin. Chama `~/softwares/home-assistant/falar.sh -a`.

O `falar.sh` **fica no repo home-assistant**: ele é a interface do Home Assistant, e
o cron de prioridades já depende dele. Duplicá-lo aqui criaria duas verdades sobre
como falar no Echo.

## Regras de decisão

| Regra | Valor | Por quê |
|---|---|---|
| Limiar de duração | 60s | Sem ele a Alexa fala a cada resposta, inclusive um "ok" de dois segundos |
| Cooldown de fundo | 120s | Uma orquestração com 10 subagentes viraria 10 anúncios |
| Cooldown carimbado por | qualquer fala | Evita falar duas vezes seguidas sobre a mesma coisa |
| Cooldown aplicado a | só `fim_background` | `fim_tarefa` e `precisa_input` sempre falam |

Configuráveis em `config.sh`.

## Erros e degradação

O princípio: **um hook que trava é pior que um hook que não existe.**

- Toda saída de `bin/notify` é 0, em qualquer cenário.
- Output indisponível (container do HA parado) → registra `FALHOU` e segue.
- Payload inválido ou vazio → registra e sai.
- Adaptador ausente → registra e sai.

## Testes

`test/run.sh` roda casos tabelados com a saída stubada, comparando a frase gerada
com a esperada. Os casos vêm do que já foi verificado à mão:

| Caso | Esperado |
|---|---|
| Turno de 20s | silêncio, com motivo no log |
| Turno de 240s | fala, com duração e pedido |
| Rajada de 4 eventos de fundo | 1 fala, 3 em cooldown |
| `precisa_input` durante cooldown | fala mesmo assim |
| Sem `sessao_nome` | cai no rótulo derivado |
| Sem `projeto` | frase sem menção a projeto |
| Texto com markdown, URL e `_` | limpo para voz |
| Duas sessões simultâneas | cada uma com seu estado e sua frase |

## Migração

Em ordem, cada passo verificável antes do seguinte:

1. Construir o repo com o adaptador do Claude Code e os testes passando.
2. Verificar paridade: as frases do repo novo batem com as do script atual.
3. Apontar `~/.claude/settings.json` para `bin/notify claude-code <evento>`.
4. Confirmar disparo real pelo log.
5. Só então remover `~/bin/claude-alexa-notify.sh`.

## Alternativas descartadas

**Núcleo genérico com config YAML por agente.** Elegante no papel: um arquivo
declarativo diz de onde vem o evento e como extrair os campos. Exige um motor de
parsing que dê conta de formatos que ninguém viu ainda. Com um agente conhecido e
um hipotético, é abstração cara demais para o que se sabe hoje.

**Um script completo por agente, compartilhando só o `falar.sh`.** É o estado atual
esticado. Barato agora, e exatamente o que produz regras divergentes depois.

**Repo único absorvendo o Home Assistant.** Amarra a camada de notificação à infra
do HA. Se um dia a saída for Slack, o repo fica com o nome errado.
