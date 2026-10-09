# babalon JS

*[Read in English](README.md)*

Editor de cenas 3D simples e amigável ao toque, feito com [Babylon.js](https://www.babylonjs.com/).
Coloque seus modelos, posicione com o dedo ou o mouse, ilumine a cena e tire fotos com efeitos, no estilo do modo foto dos jogos.

A interface abre em inglês e pode ser trocada para português no menu de projeto (ícone de pasta).

## Rodar

```bash
npm install
npm run dev
```

Para testar no celular na mesma rede Wi-Fi: `npm run dev -- --host` e abra o endereço "Network" que aparece no terminal.

`npm run build` gera a versão final em `dist/`, que pode ser publicada em qualquer hospedagem estática.

## O que dá para fazer

- **Adicionar**: GLB, glTF, OBJ, STL, FBX, PLY/SPLAT/SPZ (gaussian splats), USDZ e .babylon, por botão ou arrastando os arquivos para a janela. Também há modelos de exemplo, formas básicas e luzes.
- **Posicionar**: toque para selecionar. Com *Mover*, arraste o objeto sobre o chão com o dedo/mouse, ou use os gizmos. *Girar* e *Escala* usam gizmos. O ímã liga o encaixe na grade.
- **Cena**: lista de objetos, ocultar/mostrar, sliders de posição/rotação/escala, girar 90° (útil para modelos "deitados"), pôr no chão, duplicar, excluir, animações do modelo.
- **Material** (estilo Sketchfab): cor/tom, mostrar ou ocultar textura, metálico, rugosidade, verniz, emissão, opacidade, dupla face, sem iluminação e wireframe.
- **Luzes**: luzes prontas (Estúdio, Dia, Pôr do sol, Neon, Dramático), luz pontual, holofote e sol, com cor, intensidade, abertura, alcance, sombras e "mirar em".
- **Ambiente**: iluminação HDR com intensidade e rotação, fundo desfocado ou cor sólida, chão só de sombra ou sólido, grade.
- **Foto**: filtros prontos, campo de visão, exposição, contraste, saturação, temperatura, vinheta, bloom, granulado, aberração cromática, nitidez, desfoque de fundo (toque para focar), formatos 16:9, Cinema, 1:1, 4:5, 9:16… A foto sai em 2× a resolução da tela; no celular abre o menu de compartilhar.
- **Projeto**: novo, abrir e salvar projeto `.babalon`. O arquivo é um .zip com `project.json` (objetos, transformações, materiais, luzes, animações, ambiente, efeitos e câmera) e os arquivos originais dos modelos em `assets/`. Modelos de exemplo ficam guardados só como link. Dá para abrir também arrastando o `.babalon` para a janela.
- **Salvamento automático** no navegador (IndexedDB): ao reabrir o app aparece "Continuar de onde parou".
- **Desfazer/refazer**, **exportar a cena como .glb**, tela cheia.

### Atalhos

| Tecla | Ação |
| --- | --- |
| W / E / S | Mover / Girar / Escala |
| F | Focar seleção (ou enquadrar tudo) |
| P | Modo foto |
| Ctrl+Z / Ctrl+Y | Desfazer / Refazer |
| Ctrl+D | Duplicar |
| Ctrl+S / Ctrl+O | Salvar / abrir projeto |
| Delete | Excluir |
| Esc | Desmarcar / sair do modo foto |

Na câmera: arraste para orbitar, pinça/roda para zoom, dois dedos (ou botão direito) para mover. Toque duas vezes num objeto para focar nele.

## Estrutura

- `src/editor.ts`: núcleo, sem interface. Cena, câmera, carregamento, seleção, gizmos, luzes, sombras, ambiente, pós-processamento, captura, exportação e histórico.
- `src/project.ts`: salvar/abrir projeto (.babalon) e salvamento automático.
- `src/ui.ts`: painéis e barras, em DOM puro.
- `src/dom.ts`: helpers de interface (slider, toggle, cor, chips…).
- `src/i18n.ts`: traduções. As chaves são o texto em inglês; para outro idioma, basta adicionar um dicionário.
- `src/style.css`: tema escuro de vidro, com layout de celular abaixo de 760px.

O objeto `editor` fica disponível no console do navegador para depuração.

## Licença

Copyright (C) 2026 Guilherme Holanda Sanches

Este programa é software livre: você pode redistribuí-lo e/ou modificá-lo sob os termos da GNU General Public License publicada pela Free Software Foundation, na versão 3 da licença ou (a seu critério) qualquer versão posterior. Veja [LICENSE](LICENSE).

As bibliotecas de terceiros mantêm suas próprias licenças: Babylon.js (Apache-2.0), fflate (MIT), ícones Lucide (ISC). Os modelos de exemplo e ambientes HDR são carregados em tempo de execução do CDN de assets do Babylon.js e não são distribuídos neste repositório.
