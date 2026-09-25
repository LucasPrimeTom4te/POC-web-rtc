# Plano: tratamento de áudio da sala em grupo

Objetivo: áudio confortável em grupo, com configurações e uma cadeia de
manipuladores (Web Audio) no microfone e no que chega dos outros.

## Como está hoje

- **Microfone** (`toggleMic`, `index.html` ~7206): `getUserMedia` fixo com
  `echoCancellation`, `noiseSuppression` e `autoGainControl` ligados; sem
  escolha de aparelho, sem ganho. A faixa vai direto para
  `replaceTrackEverywhere("audio", track)`.
- **Aviso de mutado** (`mutedWatch`, ~7659): abre um **segundo**
  `getUserMedia` só para medir o nível.
- **Recebido** (`attachRemoteAudio`, ~6010): um `<audio>` por pessoa;
  `applyPeerVolume` (~15390) aplica voz/compartilhado 0–100% e mudo só para mim.
- **Fala** (~7510): nível pelo `getStats()`, acende quem está falando.
- **Configurações** (~4709): seção 🎙️ só com o aviso de mutado.

## Fase 1 — Configurações de áudio

Nova seção **🎙️ Áudio** no painel de configurações (substitui a 🎙️ Microfone,
mantendo o aviso de mutado dentro dela). Tudo guardado em `storageSet`
(`rtc.audio.*`), por aparelho.

1. **Microfone**: `<select>` com `enumerateDevices()` (`audioinput`).
   - Ao trocar com o mic ligado: novo `getUserMedia({ deviceId: { exact } })`
     e `replaceTrackEverywhere`, parando a faixa antiga.
   - Atualizar a lista em `navigator.mediaDevices.ondevicechange`.
   - Aparelho guardado sumiu → cai no padrão, com toast.
2. **Saída**: `<select>` com `audiooutput`, aplicado com `setSinkId` em todos
   os `<audio>` (voz, compartilhado, sons dos cards, rádio) e no
   `AudioContext` (`context.setSinkId`, quando houver).
   - Esconder o select quando `setSinkId` não existir (Safari/Firefox).
3. **Tratamento do navegador**: três checkboxes (eco, ruído, ganho
   automático). Com o mic ligado, aplicar na hora via
   `track.applyConstraints()`; se falhar, religar o mic.
4. **Modo música**: um checkbox que desliga os três tratamentos, desliga a
   cadeia da Fase 2 (exceto o ganho) e pede Opus estéreo com bitrate maior
   (ver Fase 4). Aviso: usar fone, senão os outros ouvem eco.
5. **Testar microfone**: medidor de nível ao vivo e botão "Ouvir a mim mesmo"
   (loopback por 5 s, com fone recomendado).

## Fase 2 — Cadeia de efeitos no microfone

Um módulo `micChain` que recebe a faixa bruta e devolve a processada:

```
getUserMedia → MediaStreamSource
  → BiquadFilter highpass (80 Hz)      tira ronco
  → GainNode (0–200%)                  ganho do microfone
  → DynamicsCompressor                 nivela alto/baixo
  → GainNode "gate"                    noise gate
  → MediaStreamDestination → replaceTrackEverywhere("audio", …)
                ↘ AnalyserNode (medidor, gate, aviso de mutado)
```

- `session.micTrack` passa a ser a faixa processada; guardar também a bruta
  (`session.micRawTrack`) para `stop()` e para `applyConstraints`.
- Um só `AudioContext` para a cadeia; fechar ao desligar o mic.
- **Noise gate**: pelo `AnalyserNode`, a cada ~20 ms compara o RMS com o
  limiar; abre rápido (~5 ms) e fecha devagar (~200 ms) com
  `gain.setTargetAtTime`, para não cortar fim de palavra.
- **Aviso de mutado** passa a reusar o mesmo microfone/analisador quando
  possível, em vez de abrir um segundo `getUserMedia`.
- Configurações (na seção da Fase 1): ganho (slider), "Filtrar ronco",
  "Nivelar minha voz" (compressor), "Cortar ruído de fundo" + limiar (gate).
- Mudo continua sendo `replaceTrack(null)`: nada sai com o mic desligado.

## Fase 3 — O que chega dos outros

1. **Volume acima de 100%**: cada pessoa passa por Web Audio.
   - `MediaStreamSource(stream)` → `GainNode` (voz 0–300%) →
     compressor opcional → `GainNode` geral → `destination`.
   - Bug do Chrome: áudio remoto em `createMediaStreamSource` fica mudo se o
     stream não estiver também num elemento → manter o `<audio>` atual com
     `muted = true` só para "puxar" o áudio.
   - Sliders de `audioControls` vão até 300%; `volumeOf` continua igual
     (valores > 1 passam a valer).
2. **Nivelar vozes**: checkbox que liga um `DynamicsCompressor` por pessoa
   (quem fala baixo sobe, quem grita desce).
3. **Volume geral**: slider único na seção 🎙️ Áudio, no `GainNode` final.
4. **Abaixar o resto quando alguém fala** (ducking): quando o detector de fala
   (~7510) acusa voz, baixa para ~30% o áudio compartilhado, os sons dos
   cards e o rádio; volta depois de ~800 ms de silêncio. Checkbox para
   desligar.
5. Fallback: se o `AudioContext` não puder rodar (sem gesto do usuário,
   navegador antigo), continuar com o `<audio>` direto como hoje (limite 100%).

## Fase 4 — Rede (Opus)

- **DTX** (não envia no silêncio) e **FEC** (`useinbandfec=1`) no `fmtp` do
  Opus, ajustando o SDP antes do `setLocalDescription`.
- Bitrate da voz via `sender.setParameters` (`maxBitrate` ~32 kbps voz;
  ~128 kbps no modo música, com `stereo=1; sprop-stereo=1`).
- Na sala grande (cada um envia N−1 cópias), DTX e bitrate menor entram no
  balanço automático existente (`rebalance`).

## Fase 5 — Confortos e efeitos (opcional)

- **Apertar para falar**: segurar espaço para falar (e o inverso: segurar
  para mutar). Ignorar quando o foco está em campo de texto.
- **Supressão de ruído forte**: RNNoise em WASM num `AudioWorklet`, como
  nó extra na cadeia da Fase 2 (checkbox "Supressão de ruído forte").
- **Efeitos de voz**: tom (robô, esquilo) via `AudioWorklet`, reverb via
  `ConvolverNode`, como nós plugáveis na cadeia.

## Ordem sugerida

1. Fase 1 (itens 1–3 e 5) + Fase 2 sem RNNoise → commit.
2. Fase 3 → commit.
3. Modo música + Fase 4 → commit.
4. Fase 5 conforme vontade.

## Testar (caminho principal)

- Duas abas/aparelhos: trocar microfone e saída com a chamada em andamento.
- Ganho, gate e compressor audíveis do outro lado; mudo não envia nada.
- Volume de uma pessoa a 250% e voltar; volume geral; ducking com áudio
  compartilhado tocando.
- Safari: sem select de saída, resto funcionando.
