/**
 * Simple translation: keys are the English text itself (the default language).
 * To add a language, create another dictionary like `PT` and include it in `DICTS`.
 */
export type Lang = 'en' | 'pt';

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
];

const STORAGE_KEY = 'babalon-lang';

let lang: Lang = readStoredLang();

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'pt' ? 'pt' : 'en';
  } catch {
    return 'en';
  }
}

export function getLang() {
  return lang;
}

export function setLang(value: Lang) {
  lang = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // No storage (e.g. private window): applies to this session only
  }
  document.documentElement.lang = locale();
}

/** Locale for dates and numbers. */
export function locale() {
  return lang === 'pt' ? 'pt-BR' : 'en-US';
}

/** Translates an English text. `{name}` is replaced by `vars.name`. */
export function tr(key: string, vars?: Record<string, string | number>) {
  let text = DICTS[lang]?.[key] ?? key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  return text;
}

const PT: Record<string, string> = {
  // Tabs
  Add: 'Adicionar',
  Scene: 'Cena',
  Material: 'Material',
  Lights: 'Luzes',
  Environment: 'Ambiente',
  Photo: 'Foto',

  // Filters and presets
  Original: 'Original',
  Cinema: 'Cinema',
  'B&W': 'P&B',
  Vintage: 'Vintage',
  Neon: 'Neon',
  Dream: 'Sonho',
  Cold: 'Frio',
  Studio: 'Estúdio',
  Daylight: 'Dia',
  Sunset: 'Pôr do sol',
  Dramatic: 'Dramático',
  Neutral: 'Neutro',
  Room: 'Sala',
  Countryside: 'Campo',
  'Parking lot': 'Estacionamento',
  Night: 'Noite',
  Screen: 'Tela',

  // Sample models, shapes and lights
  Boombox: 'Rádio',
  Helmet: 'Capacete',
  Character: 'Personagem',
  Robot: 'Robô',
  Shark: 'Tubarão',
  Airplane: 'Avião',
  Cube: 'Cubo',
  Sphere: 'Esfera',
  Cylinder: 'Cilindro',
  Cone: 'Cone',
  Torus: 'Toro',
  Plane: 'Plano',
  Point: 'Pontual',
  Spotlight: 'Holofote',
  Sun: 'Sol',
  'Point light': 'Luz pontual',

  // General
  'Drop your 3D files here': 'Solte os arquivos 3D aqui',
  'Loading {name}… {pct}%': 'Carregando {name}… {pct}%',
  'Build your scene': 'Monte sua cena',
  'Continue where you left off': 'Continuar de onde parou',
  'Last edited {date}': 'Última edição: {date}',
  'Drag GLB, glTF, OBJ, FBX, STL… files here or': 'Arraste arquivos GLB, glTF, OBJ, FBX, STL… para cá ou',
  'Choose files': 'Escolher arquivos',
  'Open project': 'Abrir projeto',
  'Browse sample models': 'Ver modelos de exemplo',
  'Undo (Ctrl+Z)': 'Desfazer (Ctrl+Z)',
  'Redo (Ctrl+Y)': 'Refazer (Ctrl+Y)',
  'Frame all (F)': 'Enquadrar tudo (F)',
  'Project: open, save, export': 'Projeto: abrir, salvar, exportar',
  Fullscreen: 'Tela cheia',
  'Exit fullscreen': 'Sair da tela cheia',
  'Photo mode (P)': 'Modo foto (P)',
  Close: 'Fechar',
  'Double-tap to reset': 'Toque duas vezes para restaurar',

  // Project
  'Project name': 'Nome do projeto',
  'my-scene': 'minha-cena',
  'New project': 'Novo projeto',
  'Open project…': 'Abrir projeto…',
  'Save project': 'Salvar projeto',
  'Export scene .glb': 'Exportar cena .glb',
  Language: 'Idioma',
  'The project ({ext}) stores models, materials, lights, environment, effects and camera. The scene is also saved automatically in this browser.':
    'O projeto ({ext}) guarda modelos, materiais, luzes, ambiente, efeitos e câmera. A cena também é salva automaticamente neste navegador.',
  'Project saved': 'Projeto salvo',
  'Opening the project will replace the current scene. Continue?': 'Abrir o projeto vai substituir a cena atual. Continuar?',
  'Could not load: {names}': 'Não foi possível carregar: {names}',
  'Project opened': 'Projeto aberto',
  'Start a new project? The current scene will be discarded.': 'Começar um projeto novo? A cena atual será descartada.',
  'Scene exported as scene.glb': 'Cena exportada como scene.glb',
  'Invalid or corrupted project file.': 'Arquivo de projeto inválido ou corrompido.',
  'This file is not a babalon JS project.': 'Este arquivo não é um projeto do babalon JS.',
  'Project created by a newer version of babalon JS.': 'Projeto criado por uma versão mais nova do babalon JS.',
  'File missing from project: {path}': 'Arquivo ausente no projeto: {path}',
  'No supported 3D file. Use: {list}': 'Nenhum arquivo 3D suportado. Use: {list}',
  'Failed to create image': 'Falha ao gerar imagem',

  // Selection
  Move: 'Mover',
  Rotate: 'Girar',
  Scale: 'Escala',
  'Snap to grid': 'Encaixar na grade',
  'Focus camera': 'Focar câmera',
  'Duplicate (Ctrl+D)': 'Duplicar (Ctrl+D)',
  'Delete (Del)': 'Excluir (Del)',
  Deselect: 'Desmarcar',

  // Add
  'Your files': 'Seus arquivos',
  'For .gltf with separate textures, select the .gltf together with its .bin and images.':
    'Para .gltf com texturas separadas, selecione o .gltf junto com .bin e imagens.',
  'Sample models': 'Modelos de exemplo',
  Shapes: 'Formas',

  // Scene
  Hide: 'Ocultar',
  Show: 'Mostrar',
  'Objects in scene': 'Objetos na cena',
  'The scene is empty.': 'A cena está vazia.',
  'Clear scene': 'Limpar cena',
  'Remove everything from the scene?': 'Remover tudo da cena?',
  'Tap an object in the scene to select it. Double-tap to focus.': 'Toque em um objeto na cena para selecioná-lo. Toque duas vezes para focar.',
  Transform: 'Transformação',
  'Position X': 'Posição X',
  Height: 'Altura',
  'Position Z': 'Posição Z',
  'Turn (Y)': 'Giro (Y)',
  'Tilt (X)': 'Inclinação (X)',
  'Roll (Z)': 'Rolagem (Z)',
  'Drop to floor': 'Pôr no chão',
  Reset: 'Resetar',
  'Casts shadow': 'Projeta sombra',
  Wireframe: 'Wireframe',
  '{vertices} vertices · {faces} faces · {materials} materials': '{vertices} vértices · {faces} faces · {materials} materiais',
  Animation: 'Animação',
  'Animation {n}': 'Animação {n}',
  Pause: 'Pausar',
  Play: 'Tocar',
  Speed: 'Velocidade',
  Object: 'Objeto',

  // Material
  'Select a model or shape to edit its materials.': 'Selecione um modelo ou forma para editar seus materiais.',
  'This object has no editable materials.': 'Este objeto não tem materiais editáveis.',
  'Material {n}': 'Material {n}',
  Opacity: 'Opacidade',
  'Double-sided': 'Dupla face',
  Color: 'Cor',
  'Tint (multiplies texture)': 'Tom (multiplica a textura)',
  'Base color': 'Cor base',
  'Show texture': 'Mostrar textura',
  Surface: 'Superfície',
  Metallic: 'Metálico',
  Roughness: 'Rugosidade',
  'Clear coat': 'Verniz (clear coat)',
  'Clear coat intensity': 'Intensidade do verniz',
  Unlit: 'Sem iluminação (unlit)',
  Emission: 'Brilho próprio',
  'Emissive color': 'Cor de emissão',
  Intensity: 'Intensidade',
  General: 'Geral',
  'Diffuse color': 'Cor difusa',
  'Specular color': 'Brilho especular',
  Glossiness: 'Dureza do brilho',
  Emissive: 'Emissão',

  // Lights
  'Lighting presets': 'Iluminação pronta',
  'Replaces the current lights. Everything can be tweaked afterwards.': 'Substitui as luzes atuais. Tudo pode ser ajustado depois.',
  'Add light': 'Adicionar luz',
  'Lights in scene': 'Luzes na cena',
  'No lights — only the environment lights the scene.': 'Sem luzes — só o ambiente ilumina a cena.',
  'Tap a light (in the list or in the scene) to adjust it. Drag it or use the gizmos to place it.':
    'Toque em uma luz (na lista ou na cena) para ajustar. Arraste-a ou use os gizmos para posicionar.',
  'Selected light': 'Luz selecionada',
  'Cone angle': 'Abertura',
  'Edge softness': 'Suavidade da borda',
  Range: 'Alcance',
  'Casts shadows': 'Projeta sombras',
  'Aim at': 'Mirar em',
  'Camera center': 'Centro da câmera',
  Aim: 'Mirar',
  'Delete light': 'Excluir luz',

  // Environment
  'Environment lighting (HDR)': 'Iluminação do ambiente (HDR)',
  Rotation: 'Rotação',
  'Extra ambient light': 'Luz ambiente extra',
  Background: 'Fundo',
  'Show environment as background': 'Mostrar ambiente ao fundo',
  'Background blur': 'Desfoque do fundo',
  'Solid color (no environment)': 'Cor sólida (sem ambiente)',
  Floor: 'Chão',
  'Shadow only': 'Só sombra',
  Solid: 'Sólido',
  None: 'Nenhum',
  'Floor color': 'Cor do chão',
  'Reference grid': 'Grade de referência',

  // Photo
  'Enter photo mode': 'Entrar no modo foto',
  Filters: 'Filtros',
  Camera: 'Câmera',
  'Field of view': 'Campo de visão',
  'Light & color': 'Luz e cor',
  Exposure: 'Exposição',
  Contrast: 'Contraste',
  Saturation: 'Saturação',
  Temperature: 'Temperatura',
  Vignette: 'Vinheta',
  Effects: 'Efeitos',
  Bloom: 'Bloom (brilho)',
  'Bloom threshold': 'Limiar do bloom',
  Grain: 'Granulado',
  'Chromatic aberration': 'Aberração cromática',
  Sharpen: 'Nitidez',
  'Depth of field': 'Profundidade de campo',
  'Blur background': 'Desfocar fundo',
  'Aperture (f)': 'Abertura (f)',
  'Focus distance': 'Distância de foco',
  'In photo mode, tap an object to focus on it.': 'No modo foto, toque em um objeto para focar nele.',
  'Reset to defaults': 'Restaurar padrão',
  'Exit photo mode': 'Sair do modo foto',
  Adjustments: 'Ajustes',
  'Take photo': 'Capturar foto',
  'Frame all': 'Enquadrar tudo',
  'Photo saved!': 'Foto salva!',

  // Tools
  Tools: 'Ferramentas',
  'Tap the second point': 'Toque no segundo ponto',
  'Tap the first point': 'Toque no primeiro ponto',
  Done: 'Concluir',
  'Multi-select (or Shift+click)': 'Seleção múltipla (ou Shift+clique)',
  'Tap objects to select': 'Toque nos objetos para selecionar',
  '{n} selected': '{n} selecionados',
  Width: 'Largura',
  Depth: 'Profundidade',
  Measure: 'Medir',
  'Stop measuring': 'Parar de medir',
  'Measure distance': 'Medir distância',
  'Tap two points: on a model they stick to its surface, elsewhere they land on the floor. Drag the points to adjust.':
    'Toque em dois pontos: em um modelo eles grudam na superfície; fora dele, caem no chão. Arraste os pontos para ajustar.',
  'Follow the surface': 'Seguir a superfície',
  'Snap to vertices': 'Encaixar nos vértices',
  'Clear measurements': 'Limpar medições',
  Guides: 'Guias',
  'Smart guides (snap while moving)': 'Guias inteligentes (encaixe ao mover)',
  'Guides are planes you can align objects to. With an object selected, a new guide starts at its top (height) or center (X/Z).':
    'Guias são planos para alinhar objetos. Com um objeto selecionado, a guia nova começa no topo dele (altura) ou no centro (X/Z).',
  straight: 'reta',
  surface: 'superfície',
  Delete: 'Excluir',
  'Guide {name}': 'Guia {name}',
  Bottom: 'Base',
  Min: 'Mín.',
  Center: 'Centro',
  Top: 'Topo',
  Max: 'Máx.',
  'Align & match': 'Alinhar e igualar',
  'Select 2 or more objects (multi-select button or Shift+click). The first one selected is the reference.':
    'Selecione 2 ou mais objetos (botão de seleção múltipla ou Shift+clique). O primeiro selecionado é a referência.',
  'Multi-select': 'Seleção múltipla',
  'Reference: {name}': 'Referência: {name}',
  'Align left': 'Alinhar à esquerda',
  'Align centers': 'Alinhar centros',
  'Align right': 'Alinhar à direita',
  'Align bottoms': 'Alinhar bases',
  'Align middles': 'Alinhar meios',
  'Align tops': 'Alinhar topos',
  'Align backs': 'Alinhar fundos',
  'Align fronts': 'Alinhar frentes',
  'Match the reference': 'Igualar à referência',
  'Stack on top': 'Empilhar em cima',
  'Distribute X': 'Distribuir X',
  'Distribute Z': 'Distribuir Z',
  'Drag to move the guide': 'Arraste para mover a guia',
  'Install app': 'Instalar app',
  'Orbit around this object': 'Orbitar em volta deste objeto',
  'Orbiting around {name}': 'Orbitando em volta de {name}',
  'View in AR': 'Ver em AR',
  'Could not start AR: {error}': 'Não foi possível iniciar o AR: {error}',
  'Move the phone slowly to find the floor': 'Mova o celular devagar para encontrar o chão',
  'Tap to place the scene': 'Toque para colocar a cena',
  'Drag to turn · pinch to resize': 'Arraste para girar · pinça para redimensionar',
  'Exit AR': 'Sair do AR',
  'AR options': 'Opções do AR',
  'Show interface': 'Mostrar interface',
  'Hide interface': 'Esconder interface',
  Lighting: 'Iluminação',
  'Real room': 'Ambiente real',
  'Heavier: uses the phone to estimate the room light.': 'Mais pesado: usa o celular para estimar a luz do ambiente.',
  'Light intensity': 'Intensidade da luz',
  'Photo filter': 'Filtro da foto',
  'Show FPS': 'Mostrar FPS',
  Share: 'Compartilhar',
  'Shadows on the floor': 'Sombras no chão',
  'Room lighting (heavier)': 'Luz do ambiente (mais pesado)',
  'Move the scene': 'Mover a cena',
  'Real size (1:1)': 'Tamanho real (1:1)',
  "This phone doesn't share the camera image with the browser. Use the system screenshot.": 'Este celular não compartilha a imagem da câmera com o navegador. Use o print do sistema.',
  'A new version is available': 'Há uma versão nova disponível',
  Update: 'Atualizar',
  'Ready to work offline': 'Pronto para usar offline',
};

const DICTS: Partial<Record<Lang, Record<string, string>>> = { pt: PT };
