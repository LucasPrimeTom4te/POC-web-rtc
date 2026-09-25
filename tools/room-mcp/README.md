# MCP "sala"

Deixa o Claude entrar numa sala do app como mais uma pessoa: ler e mandar
mensagens no chat, ver quem está lá e compartilhar uma janela do Mac.

Usa o app de verdade num Chrome (o chat vai direto entre os aparelhos, por
WebRTC, então só dá para ler estando na sala). O Chrome abre com janela, que
fica minimizada, porque sem janela ele não captura a tela.

## Ferramentas

| Ferramenta | O que faz |
| --- | --- |
| `sala_entrar` | entra na sala (`sala`, `nome`, `janela` a compartilhar) |
| `sala_mensagens` | mensagens ainda não lidas (a primeira traz o histórico) |
| `sala_enviar` | manda uma mensagem |
| `sala_pessoas` | quem está lá, com microfone, som e tela |
| `sala_compartilhar_tela` | compartilha uma janela (`janela`) ou para (`parar`) |
| `sala_sair` | sai e fecha o Chrome |

## Usar

    cd tools/room-mcp && npm install

O `.mcp.json` na raiz do projeto registra o servidor; o Claude Code pergunta
se pode usar na próxima vez que abrir aqui. `SALA_SITE` troca o endereço do
app (padrão: https://tom4te-rooms.vercel.app).

Compartilhar a tela: o Chrome precisa de permissão em Ajustes do Sistema →
Privacidade e Segurança → Gravação de Tela (depois de dar, feche e abra o
Chrome de novo).
