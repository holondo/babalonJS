<p align="center">
  <img src="public/icons/icon-512.png" alt="babalon JS icon" width="160" />
</p>
<h1 align="center">
  <img src="design/lettering.png" alt="babalon JS" width="360" />
</h1>
<p align="center"><em><a href="README.md">Read in English</a></em></p>

<p align="center">
  <a href="https://holondo.github.io/babalonJS/">
    <img src="https://img.shields.io/badge/Abrir%20Web%20App-BabalonJS-F3C239?style=for-the-badge&logo=googlechrome&logoColor=120D1B&labelColor=120D1B" alt="Abrir Web App" />
  </a>
</p>

Editor de cenas 3D simples e amigável ao toque, feito com [Babylon.js](https://www.babylonjs.com/).
Coloque seus modelos, posicione com o dedo ou o mouse, ilumine a cena e tire fotos com efeitos, no estilo do modo foto dos jogos.

A interface abre em inglês e pode ser trocada para português no menu de projeto (ícone de pasta).

## Capturas de Tela

<p align="center">
  <img src="public/screenshots/Screenshot_20261015_152124_babalon%20JS.jpg" width="24%" alt="Editor de cena 3D" />
  <img src="public/screenshots/Screenshot_20261015_152330_babalon%20JS.jpg" width="24%" alt="Modo foto" />
  <img src="public/screenshots/Screenshot_20261015_152441_babalon%20JS.jpg" width="24%" alt="Realidade Aumentada (AR)" />
  <img src="public/screenshots/Screenshot_20261015_152227_babalon%20JS.jpg" width="24%" alt="Ajuste de poses e articulações" />
</p>
<p align="center">
  <img src="public/screenshots/Screenshot_20261015_152200_babalon%20JS.jpg" width="24%" alt="Poses prontas" />
  <img src="public/screenshots/Screenshot_20261015_152043_babalon%20JS.jpg" width="24%" alt="Biblioteca de modelos gratuitos" />
  <img src="public/screenshots/Screenshot_20261015_151642_babalon%20JS.jpg" width="24%" alt="Montagem de cena e importação" />
</p>

## Rodar

```bash
npm install
npm run dev
```

Para testar no celular na mesma rede Wi-Fi: `npm run dev -- --host` e abra o endereço "Network" que aparece no terminal.

`npm run build` gera a versão final em `dist/`, que pode ser publicada em qualquer hospedagem estática. `npm run preview` serve essa versão localmente (use para testar o PWA: o service worker só funciona na versão final).

### Instalar como app (PWA)

O babalon JS é um Progressive Web App. Publicado em HTTPS (ou em `localhost`), o navegador oferece a instalação: ícone de instalar na barra de endereço do Chrome/Edge, item **Instalar app** no menu de projeto, ou *Adicionar à tela inicial* no Android/iOS. Instalado, ele:

- funciona offline (o app inteiro fica em cache; 6 ambientes HDR padrão já vêm incluídos; outros modelos de exemplo entram no cache na primeira vez que são usados);
- no computador, aparece em "Abrir com" para arquivos `.babalon`, `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.ply`, `.splat` e `.spz`;
- no Android, aparece no menu **Compartilhar** do sistema: em qualquer gerenciador de arquivos (ex.: Meus Arquivos da Samsung) selecione arquivos 3D individuais ou múltiplos (inclusive `.gltf` com texturas e `.bin`) ou um projeto `.babalon` → Compartilhar → babalon JS;
- mostra um botão **Atualizar** quando sai uma versão nova, em vez de recarregar sozinho.

## O que dá para fazer

Organização: o logo abre o menu de projeto, o canto superior direito alterna entre **Editar / Foto / AR**, a barra inferior tem **Adicionar, Objetos, Luz e Ferramentas**, e os botões flutuantes no canto inferior direito enquadram a cena, ligam o modo giroscópio e a tela cheia, e escondem a interface.


- **Adicionar**: GLB, glTF, OBJ, STL, FBX, PLY/SPLAT/SPZ (gaussian splats), USDZ e .babylon, por botão ou arrastando os arquivos para a janela. Também há modelos de exemplo, formas básicas e luzes.
- **Posicionar**: toque para selecionar. Com *Mover*, arraste o objeto sobre o chão com o dedo/mouse, ou use os gizmos. *Girar* e *Escala* usam gizmos. O ímã liga o encaixe na grade.
- **Cena**: lista de objetos, ocultar/mostrar, sliders de posição/rotação/escala, girar 90° (útil para modelos "deitados"), pôr no chão, duplicar, excluir.
- **Ferramentas**:
  - *Medir*: toque em dois pontos para medir. Os pontos grudam na superfície do modelo (e acompanham quando ele se move) ou caem no chão. A medida pode seguir a superfície do modelo em vez de ser uma reta. Encaixe em vértices, unidades m/cm/mm/in/ft, arraste os pontos para ajustar.
  - *Guias*: planos horizontais (altura) e verticais (X/Z) para alinhar coisas, posicionados por valor ou na base/centro/topo da seleção.
  - *Guias inteligentes*: ao mover, o objeto encaixa nas bordas e centros dos outros objetos, nas guias e no chão, no estilo do Figma.
  - *Alinhar e igualar* (2+ objetos, o primeiro selecionado é a referência): alinhar bordas/centros em cada eixo, igualar altura/largura/profundidade/escala, empilhar em cima, distribuir, pôr no chão.
  - *Tamanho*: campos de largura/altura/profundidade no painel Cena deixam o objeto com um tamanho exato.
- **Seleção múltipla**: Shift/Ctrl+clique, ou o botão de seleção múltipla em telas de toque. Mover, excluir e duplicar valem para todos os selecionados.
- **Animar** (Objetos → Animar):
  - *Animações*: tocar, pausar, repetir ou tocar uma vez, velocidade e um slider de quadro. Um quadro pausado ou arrastado fica como pose parada nas fotos, no AR e nos projetos salvos. Trocar de animação tocando faz uma transição suave.
  - *Biblioteca de animações*: 43 animações livres (parado, andar, correr, pular, sentar, dançar, luta…) que se aplicam com um toque a qualquer personagem humanoide, sejam quais forem os nomes dos ossos (estilo Mixamo, Unreal, Blender/Rigify, VRM/VRoid…). Também dá para importar seus próprios arquivos de animação (GLB/glTF/FBX). Opcionalmente mantém o personagem no lugar.
  - *Movimento simples*: girar, flutuar, pulsar ou balançar qualquer objeto, sem keyframes. Dá para movê-lo enquanto ele se mexe.
- **Pose** (personagens com esqueleto): toque numa articulação e gire com os anéis ou com os sliders Dobrar/Torcer/Inclinar; arraste uma mão ou um pé e o braço ou a perna acompanha (IK). Espelhe a pose ou copie um lado para o outro, poses prontas (relaxado, acenar, apontar, sentado, andando, mirando…) e volte à animação quando quiser. Esqueletos com nomes de ossos incomuns podem ser indicados à mão.
- **Esqueleto** (modelos sem esqueleto): dê o esqueleto padrão livre a um personagem em pé. Arraste as articulações sobre o modelo numa vista de frente (esquerda e direita se espelham, a profundidade é encontrada automaticamente), aplique a pele com pesos por envelopes ou difusão de calor (ambos calculados em segundo plano), confira com uma pose de teste e um mapa de pesos, e confirme. Depois de posicionar as articulações, **Vincular a malha** oferece **Aplicar rig** ou **Comparar tratamentos**. Os tratamentos experimentais da deformação são **Pesos diretos**, **Proteção do tronco** e **Rotação distribuída**. **Criar comparação** gera três cópias a partir de um cálculo de pesos; as poses prontas afetam as três, e o original fica oculto. As configurações e os pesos são preservados ao reabrir o projeto. Depois o modelo pode fazer poses, ser animado com a biblioteca e exportado em GLB com o esqueleto. Experimente com o exemplo *Manequim sem esqueleto*. Veja [o guia de comparação](docs/rigging_comparison.md).
- **Material** (estilo Sketchfab): cor/tom, mostrar ou ocultar textura, metálico, rugosidade, verniz, emissão, opacidade, dupla face, sem iluminação e wireframe.
- **Luzes**: luzes prontas (Estúdio, Dia, Pôr do sol, Neon, Dramático), luz pontual, holofote e sol, com cor, intensidade, abertura, alcance, sombras e "mirar em".
- **Ambiente**: iluminação HDR com intensidade e rotação, fundo desfocado ou cor sólida, chão só de sombra ou sólido, grade.
- **Foto**: filtros prontos, campo de visão, exposição, contraste, saturação, temperatura, vinheta, bloom, granulado, aberração cromática, nitidez, desfoque de fundo (toque para focar), formatos 16:9, Cinema, 1:1, 4:5, 9:16… A foto sai em 2× a resolução da tela e é salva direto no aparelho, com um botão **Compartilhar** por alguns segundos.
- **AR** (Android com ARCore, no Chrome ou no app instalado): o botão **AR** abre a câmera; toque numa superfície detectada para colocar a cena inteira em tamanho real, arraste para girar, pinça para redimensionar (**1:1** volta ao tamanho real). O AR começa na configuração mais leve; o painel de opções liga sombras no chão real, os estilos de iluminação do editor (ou a luz estimada do ambiente), intensidade da luz, filtros de foto e um contador de FPS. O botão de olho esconde a interface. Desligando **Fundo da câmera** você tem o *AR virtual*: anda em volta da cena no ambiente dela (céu, chão) em vez do cômodo, e **Colocar na minha frente** funciona sem superfície detectada. O botão de foto salva câmera + 3D quando o celular compartilha a imagem da câmera com o navegador; senão, use o print do sistema. Não disponível no iPhone (o Safari não tem AR via WebXR).
- **Modo giroscópio** (celulares, inclusive iPhone): o botão de celular na barra superior ou no modo foto gira a câmera conforme você gira e inclina o celular, somado aos gestos de toque. Não precisa de câmera, e todos os efeitos de foto continuam funcionando.
- **Projeto**: novo, abrir e salvar projeto `.babalon`. O arquivo é um .zip com `project.json` (objetos, transformações, materiais, luzes, animações, poses, esqueletos, ambiente, efeitos e câmera), os arquivos originais dos modelos e das animações em `assets/` e os pesos da pele em `rigs/`. Modelos de exemplo ficam guardados só como link. Dá para abrir também arrastando o `.babalon` para a janela.
- **Salvamento automático** no navegador (IndexedDB): ao reabrir o app aparece "Continuar de onde parou".
- **Desfazer/refazer**, **exportar a cena como .glb**, tela cheia.

### Atalhos

| Tecla | Ação |
| --- | --- |
| W / E / S | Mover / Girar / Escala |
| F | Focar seleção (ou enquadrar tudo) |
| O | Orbitar em volta do objeto selecionado |
| M | Modo medir |
| P | Modo foto |
| H | Esconder / mostrar a interface |
| Ctrl+Z / Ctrl+Y | Desfazer / Refazer |
| Ctrl+D | Duplicar |
| Ctrl+S / Ctrl+O | Salvar / abrir projeto |
| Delete | Excluir |
| Esc | Desmarcar / sair do modo foto |

Na câmera: arraste para orbitar, pinça/roda para zoom, dois dedos (ou botão direito) para mover. Toque duas vezes num objeto para focar nele, ou no chão vazio para orbitar em volta daquele ponto. O botão de órbita na barra de seleção torna o objeto selecionado o centro da órbita, sem mudar o zoom. Um pontinho dourado mostra o centro enquanto a câmera se move.

## Estrutura

O `src/` é organizado por domínio:

- `core/`: o núcleo do editor, sem interface (cena, câmera, carregamento, seleção, gizmos, luzes, sombras, ambiente, pós-processamento, captura, exportação, histórico), projetos e salvamento automático, presets compartilhados, arquivos e traduções.
- `ui/`: a interface em DOM puro. `ui.ts` é a estrutura (barras, dock, menus); cada painel fica em `ui/panels/`; `photo.ts` é o modo foto; `dom.ts` tem os componentes reutilizáveis; `style.css` é o tema escuro de vidro, com layout de celular abaixo de 760px.
- `animation/`: reprodução de animações, movimento simples, poses (FK, IK, espelho, poses prontas) e animações feitas para outros esqueletos.
- `rigging/`: detecção dos ossos de humanoides, o esqueleto padrão, o rigging manual, a busca das articulações e os pesos da pele (difusão de calor num Web Worker).
- `ar/`: realidade aumentada com WebXR e os controles sobre a câmera.
- `tools/`: medições (inclusive o caminho pela superfície), guias, guias inteligentes e alinhamento.
- `device/`: modo giroscópio e cores das barras do sistema.

Além disso: `vite.config.ts` (manifesto do PWA, cache offline e associação de arquivos); `public/animations`, `public/models` (a biblioteca livre de animações e os manequins de exemplo, CC0, veja [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), gerados por `scripts/build-animation-library.mjs`); `public/icons`, `public/brand` (ícones e lettering do app, gerados a partir das artes em tamanho original em `design/`).

O objeto `editor` fica disponível no console do navegador para depuração.

A integração Android utiliza Capacitor 8, pontes nativas para arquivos e uma Activity nativa com SceneView (Filament) + ARCore para sessões de realidade aumentada em aparelhos compatíveis, enquanto o PWA web oferece WebXR AR. Veja [Native Android AR integration](docs/android_ar.md) para detalhes de arquitetura e comandos de verificação.

## Licença

Copyright (C) 2026 Guilherme Holanda Sanches

Este programa é software livre: você pode redistribuí-lo e/ou modificá-lo sob os termos da GNU General Public License publicada pela Free Software Foundation, na versão 3 da licença ou (a seu critério) qualquer versão posterior. Veja [LICENSE](LICENSE).

As bibliotecas de terceiros mantêm suas próprias licenças: Babylon.js (Apache-2.0), fflate (MIT), ícones Lucide (ISC), meshoptimizer (MIT), ktx2-encoder (MIT) com o codificador Basis Universal (Apache-2.0), ktx-parse (MIT) e glTF-Transform (MIT). As animações e os manequins incluídos são CC0 (Universal Animation Library, de Quaternius). Os seis ambientes HDR pré-filtrados incluídos são CC BY 4.0 do repositório Babylon.js Assets. Todos os recursos de terceiros estão listados em [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Outros modelos de exemplo são carregados em tempo de execução do CDN do Babylon.js e não são distribuídos neste repositório.
