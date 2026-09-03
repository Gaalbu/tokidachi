# Plano de validação — v0.4.0 (custo de API + multiplataforma)

Documento de execução para agente (Codex/Claude). Cada seção tem: estado
observado, o que validar, comandos exatos, resultado esperado e critério de
aprovação. Nada aqui altera código de produção sem passo explícito.

Baseline verificado em 2026-08-28, commit `87c2f2a`, tag mais recente `v0.3.0`,
`pom.xml` em `0.3.1`.

---

## Parte 0 — Preparação do ambiente de validação

Objetivo: nunca validar contra a config real do usuário. Todo teste de API usa
`XDG_CONFIG_HOME`/`XDG_CACHE_HOME` isolados.

```bash
export TOKI=/home/gaalbu/codigos/tokidachi
export SANDBOX=$(mktemp -d)/toki
mkdir -p "$SANDBOX/cfg/tokidachi" "$SANDBOX/cache"
cp "$TOKI/config/api-usage.json" "$SANDBOX/cfg/tokidachi/"
```

Invocação padrão do collector durante a validação:

```bash
XDG_CONFIG_HOME=$SANDBOX/cfg XDG_CACHE_HOME=$SANDBOX/cache $TOKI/target/tokidachi --pretty
```

**Regra de segurança:** nenhuma chave real de API deve ser escrita em arquivo,
argumento de processo, log ou commit. Só variável de ambiente na sessão.

**Aprovação da Parte 0:** `target/tokidachi` existe (senão `make native`), e o
sandbox não toca `~/.config/tokidachi`.

---

## Parte 1 — Regressão da base (assinatura Claude/Codex)

Estado: funcionando. Serve de rede de proteção antes de mexer em qualquer coisa.

### 1.1 Suíte automatizada

```bash
cd $TOKI && make test
```

Esperado: `mvn test` verde; `node --check` sem erro nos dois arquivos;
4 suítes Node com `# fail 0`.

> Atenção: `tests/ui-source.test.js` e `tests/branding.test.js` **falham** se
> executadas com `--experimental-default-type=module`. Use exatamente as linhas
> do `Makefile` (`node --test`, sem a flag). Uma falha aqui provavelmente é o
> comando errado, não regressão.

### 1.2 Coleta real

```bash
cd $TOKI && ./target/tokidachi --pretty
```

Esperado: `version: 1`, `updatedAt` recente, `providers.claude` e
`providers.codex` com `status: "ok"` e ao menos uma janela com `usedPercent`
numérico e `resetLabel` legível.

### 1.3 Degradação independente

- Renomear temporariamente as credenciais do Codex e reexecutar: Claude segue
  `ok`, Codex vai a `error`/`stale` sem derrubar o outro.
- Repetir invertido.
- Reexecutar dentro de 30 min após uma coleta boa: provider falho deve voltar
  `stale` com janelas do cache, não em branco.

**Aprovação da Parte 1:** suíte verde, coleta real válida, isolamento entre
providers e fallback de cache confirmados.

---

## Parte 2 — Monitor de custo de API

### 2.1 Estado observado (não repetir a descoberta, apenas confirmar)

- Contrato aditivo `apiUsage` implementado no collector e consumido pelo widget.
- `openai-costs`: implementado, exige `TOKIDACHI_OPENAI_ADMIN_KEY` (admin de
  organização). Nunca exercitado com chave válida.
- `anthropic-costs`: **stub**, sempre `unavailable`.
- Widget só renderiza `status: "ok"`. Demais estados ficam invisíveis.
- `~/.config/tokidachi/api-usage.json` ausente na máquina do usuário.
- Extensão instalada em `~/.local/share/gnome-shell/extensions/` está atrasada
  em relação ao repo (`extension.js`, `i18n.js`, `providerModel.js` divergem).

### 2.2 Matriz de estados a validar

| # | Config | Credencial | `apiUsage` esperado | Widget |
|---|---|---|---|---|
| A | tudo `enabled:false` | — | campo **ausente**, zero requisição | seção ausente |
| B | codex `enabled:true` | ausente | `unauthenticated` | nada visível |
| C | codex `enabled:true` | inválida | `unauthenticated` (401/403) | nada visível |
| D | codex `enabled:true` | válida | `ok` + `currency` + `estimatedCost` | linha "Estimated API cost" |
| E | claude `enabled:true` | qualquer | `unavailable` | nada visível |
| F | `collector` desconhecido | — | `unavailable`, sem rede | nada visível |
| G | arquivo corrompido/JSON inválido | — | campo ausente (fail-safe) | seção ausente |
| H | arquivo é symlink | — | ignorado (`NOFOLLOW_LINKS`) | seção ausente |
| I | arquivo > 64 KB | — | ignorado | seção ausente |
| J | `periodDays` fora de 1–31 | — | cai para 30, sem erro | — |
| K | 9+ providers no array | — | só os 8 primeiros | — |
| L | `id` inválido / duplicado | — | entrada descartada | — |

A, B, C, E já foram confirmados empiricamente no baseline. **D, F, G, H, I, J,
K, L continuam pendentes.**

### 2.3 Procedimento

Para cada linha, editar `$SANDBOX/cfg/tokidachi/api-usage.json` e reexecutar o
collector do sandbox, inspecionando `providers.<id>.apiUsage`.

Caso D (único que precisa de credencial real):
```bash
TOKIDACHI_OPENAI_ADMIN_KEY='<chave admin da org>' \
  XDG_CONFIG_HOME=$SANDBOX/cfg XDG_CACHE_HOME=$SANDBOX/cache \
  $TOKI/target/tokidachi --pretty
```
Conferir: `currency` com 3 letras maiúsculas, `estimatedCost` string decimal
sem notação científica, `periodStart`/`periodEnd` coerentes com `periodDays`,
e o valor batendo (±arredondamento) com o painel de custos da OpenAI no mesmo
intervalo.

**Se não houver conta com admin key de organização, D é BLOQUEADO.** Registrar
como bloqueio explícito — não marcar a feature como validada, e não inferir que
funciona só porque o 401 responde.

### 2.4 Verificação de vazamento de credencial

Após o caso D:

```bash
grep -ri "$(echo $TOKIDACHI_OPENAI_ADMIN_KEY | cut -c1-12)" $SANDBOX ~/.cache/tokidachi ~/.config/tokidachi 2>/dev/null
journalctl --user -b -o cat | grep -i "sk-\|admin_key" | head
```

Esperado: **zero** ocorrências. Conferir também que a mensagem de erro nunca
inclui corpo de resposta da OpenAI.

### 2.5 Comportamento do widget

Instalar o build atual e reiniciar a sessão GNOME (Wayland exige logout/login,
não `Alt+F2 r`):

```bash
cd $TOKI && make install
```

Validar visualmente:
- Caso A: nenhuma linha de custo.
- Caso D: linha "Estimated API cost: USD x.xx" (e a tradução PT-BR "Custo
  estimado de API"), marcada como estimativa, sem parecer fatura.
- Desabilitar depois de D: a linha some no refresh seguinte (≤5 min) e nenhuma
  requisição nova sai.

### 2.6 Lacunas identificadas — decidir antes de fechar a validação

1. **Sem teste do caminho de sucesso HTTP.** `ApiCostCollectorTest` cobre
   parsing estático e casos de erro, mas nenhum teste stuba o `HttpClient` para
   exercitar `status: "ok"` fim-a-fim. Recomendação: adicionar antes de liberar.
2. **Estados não-`ok` são invisíveis no widget.** O usuário habilita e não vê
   nada — indistinguível de "não configurei". Decidir: renderizar
   `unavailable`/`unauthenticated` como linha discreta, ou documentar que só
   `ok` aparece e oferecer um comando de diagnóstico.
3. **`anthropic-costs` é stub.** Ou implementar (exige adapter com paginação
   diária do relatório de custos da org), ou remover a entrada `claude` do
   `config/api-usage.json` semeado, para não sugerir uma capacidade inexistente.
4. **Config ausente em instalações antigas.** `install.sh` só semeia
   `api-usage.json` em nova instalação; quem instalou antes do commit `8738755`
   nunca recebe o arquivo. Validar o caminho de upgrade.
5. **Escopo real da métrica.** Ambas as APIs de custo são *organização/admin*.
   Confirmar que README e `docs/API_USAGE.md` não deixam o usuário individual
   achar que verá o gasto pessoal dele.

**Aprovação da Parte 2:** matriz A–L verde (ou D formalmente bloqueado),
zero vazamento de credencial, widget coerente nos dois idiomas, e as 5 lacunas
com decisão registrada.

---

## Parte 3 — Windows e macOS

### 3.1 Estado observado

Não existe suporte, nem parcial. O que existe é apenas a decisão arquitetural em
`docs/CROSS_PLATFORM.md`: o host visual é extensão GNOME Shell e não é portável;
qualquer suporte novo é um **host adicional** consumindo o JSON do collector.
CI (`ci.yml`, `release.yml`) roda só `ubuntu-24.04`; o único artefato é
`tokidachi-linux-x86_64.tar.gz`; o binário é nativo GraalVM, portanto precisa de
build por SO.

### 3.2 O que validar agora (auditoria de honestidade)

Não há build para testar; a validação nesta fase é garantir que o projeto **não
promete** o que não entrega:

```bash
cd $TOKI
grep -rin "windows\|macos\|mac os\|cross-platform" README.md docs/ | grep -vi "5-hour window\|7-day window\|1-week window\|limit window\|usage window\|rate-limit"
```

Esperado: nenhuma afirmação de suporte a Windows/macOS fora do documento de
decisão e de escopo futuro. Qualquer badge, título ou frase que sugira suporte
deve ser corrigida.

Conferir também que o `release gate` de `CROSS_PLATFORM.md` (artefato
reprodutível em CI + smoke test com fixture + teste manual no SO alvo + doc de
install/update/uninstall) está literalmente refletido nos critérios de
aceitação do issue de multiplataforma.

### 3.3 Validação da portabilidade do collector (o único pedaço reaproveitável)

Antes de escolher host, provar que o collector é de fato portável:

- Compilar o JAR sombreado (`make jar`) e rodá-lo com `java -jar` — sem
  dependência de GNOME.
- Inventariar todo caminho/comando específico de Linux no código Java
  (`XDG_*`, `~/.config`, `~/.cache`, chamadas a `claude`/`codex` no PATH,
  permissões `chmod 700`). Cada um vira item de portabilidade documentado:
  no Windows, `%APPDATA%`/`%LOCALAPPDATA%`; no macOS,
  `~/Library/Application Support`.
- Confirmar que a descoberta de credencial de Claude/Codex tem caminho
  equivalente nos outros SOs — **este é o maior risco do épico**, porque se o
  CLI guarda credenciais em local não previsto, o host novo não coleta nada.

### 3.4 Fatia vertical mínima proposta (para o issue de implementação)

Sem parear com o visual GNOME. Um host por SO que: executa o collector como
processo filho, valida o JSON, exibe as janelas de Claude/Codex, atualiza em
timer limitado e mostra estado de falha explícito. Arrastar, mascote e temas
ficam fora.

Critério de "pronto para validar" por SO:
1. artefato reprodutível gerado em CI daquele SO;
2. smoke test que roda o collector e renderiza fixture válida;
3. teste manual no SO real, com screenshot;
4. install/update/uninstall documentado e testado;
5. comportamento de autenticação de primeira execução documentado.

**Aprovação da Parte 3:** documentação sem promessa falsa, inventário de
portabilidade do collector completo, e critérios de release por SO escritos.
A validação funcional de Windows/macOS permanece **bloqueada por ausência de
implementação** — registrar assim, não como "reprovado".

---

## Parte 4 — Higiene de release

- Extensão instalada está atrasada em relação ao repo. Rodar `make install` e
  confirmar que `diff -rq` entre `~/.local/share/gnome-shell/extensions/
  tokidachi@gaalbu.github.io` e `tokidachi@gaalbu.github.io/` só acusa o
  diretório `collector` (esperado) — nada mais.
- Remover `tokidachi@gaalbu.github.io/__pycache__` do diretório da extensão e
  garantir que `.gitignore`/`package.sh` não o incluam no tarball.
- Conferir que o tarball de release contém `config/api-usage.json` (regressão
  corrigida em `87c2f2a`):
  ```bash
  cd $TOKI && make package && tar tzf dist/tokidachi-linux-x86_64.tar.gz | grep config/
  ```
- Alinhar versão: `pom.xml` em `0.3.1`, último tag `v0.3.0`, `User-Agent` do
  `ApiCostCollector` fixo em `"tokidachi/0.3.1"` (string hardcoded — decidir se
  passa a derivar da versão do build). Nenhum tag `v0.4.0` existe ainda.

---

## Checklist final

- [ ] Parte 1 completa (suíte + coleta real + degradação + cache)
- [ ] Parte 2: matriz A–L, com D validado **ou** bloqueio registrado
- [ ] Parte 2: zero vazamento de credencial comprovado
- [ ] Parte 2: 5 lacunas com decisão registrada
- [ ] Parte 3: auditoria de documentação sem promessa de Windows/macOS
- [ ] Parte 3: inventário de portabilidade do collector
- [ ] Parte 4: higiene de release
- [ ] Relatório final separando: validado / bloqueado / reprovado
