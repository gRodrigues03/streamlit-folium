import {RenderData, Streamlit} from "streamlit-component-lib"
import {debounce} from "underscore"

/* Sometimes we get a new render event when we are still
   initializing the map. This happens during the load of
   external javascript.
   This variable is used as a flag during loading to ignore
   that extra render event.
*/
let ignore_render = false;

type GlobalData = {
  last_object_clicked: any
  last_object_clicked_tooltip: string | null
  last_object_clicked_popup: string | null
  last_active_drawing: any
  all_drawings: any
  zoom: any
  previous_data: any
  last_zoom: any
  last_center: any
  height: any
  selected_layers: Record<string, { name: string; url: string }>
}

declare global {
  interface Window {
    __GLOBAL_DATA__: GlobalData
    initComponent: any
    map: any
    drawnItems: any
    Streamlit: any
  }
}

function onMapClick() {
  debouncedUpdateComponentValue(window.map)
}

let debouncedUpdateComponentValue = debounce(updateComponentValue, 250)

function updateComponentValue(map: any) {
  const global_data = window.__GLOBAL_DATA__
  let previous_data = global_data.previous_data
  let bounds = map.getBounds()
  let zoom = map.getZoom()
  let _data = {
    last_object_clicked: global_data.last_object_clicked,
    last_object_clicked_tooltip: global_data.last_object_clicked_tooltip,
    last_object_clicked_popup: global_data.last_object_clicked_popup,
    all_drawings: global_data.all_drawings,
    last_active_drawing: global_data.last_active_drawing,
    bounds: bounds,
    zoom: zoom,
    center: map.getCenter(),
    selected_layers: Object.values(global_data.selected_layers)
  }

  if (JSON.stringify(previous_data) !== JSON.stringify(_data)) {
    global_data.previous_data = _data
    Streamlit.setComponentValue(_data)
  }
}

function onMapMove() {
  debouncedUpdateComponentValue(window.map)
}

function extractContent(s: string) {
  const span = document.createElement("span")
  span.innerHTML = s
  return (span.textContent || span.innerText).trim()
}

function onLayerClick(e: any) {
  console.log('onLayerClick fired')
  const global_data = window.__GLOBAL_DATA__
  global_data.last_object_clicked = e.latlng
  if (e.sourceTarget._tooltip && e.sourceTarget._tooltip._content) {
    global_data.last_object_clicked_tooltip = extractContent(e.sourceTarget.getTooltip().getContent())
  } else if (e.target._tooltip && e.target._tooltip._content) {
    global_data.last_object_clicked_tooltip = e.target.getTooltip().getContent()(e.sourceTarget).innerText
  }

  if (e.sourceTarget._popup && e.sourceTarget._popup._content) {
    global_data.last_object_clicked_popup = e.sourceTarget.getPopup().getContent().innerText
  } else if (e.target._popup && e.target._popup._content) {
    global_data.last_object_clicked_popup = e.target.getPopup().getContent()(e.sourceTarget).innerText
  }

  let details: Array<any> = []
  if (e.layer && e.layer.toGeoJSON) {
    global_data.last_active_drawing = e.layer.toGeoJSON()
  }
  if (window.drawnItems.toGeoJSON) {
    details = window.drawnItems.toGeoJSON().features
  }
  global_data.all_drawings = details
  debouncedUpdateComponentValue(window.map)
}

function onCreate(e: any) {
    if (!e.layer.options.original) e.layer.options.original = {};
    if (!e.layer.options.editing) e.layer.options.editing = {};

    // Now it’s safe to set
    if (typeof e.layer.options.original.className !== 'string') {
        e.layer.options.original.className = '';
    }
    if (typeof e.layer.options.editing.className !== 'string') {
        e.layer.options.editing.className = '';
    }
    if (!window.drawnItems.hasLayer(e.layer)) {
        window.drawnItems.addLayer(e.layer);
    }
    console.log('Drawn items')
    window.drawnItems.eachLayer((l: { options: any; }) => console.log(l.options));
    onLayerClick(e)
}

window.Streamlit = Streamlit;

window.initComponent = (map: any, return_on_hover: boolean) => {
  const global_data = window.__GLOBAL_DATA__
  map.on("click", onMapClick)
  map.on("moveend", onMapMove)
  for (let key in map._layers) {
    let layer = map._layers[key]
    if (layer && layer["_url"] && layer["wmsParams"] && layer["wmsParams"]["layers"]) {
      const layerName = layer["wmsParams"]["layers"];
      const layerUrl = layer["_url"];

      const layerKey = `${layerUrl},${layerName}`;

      if (!global_data.selected_layers[layerKey]) {
        global_data.selected_layers[layerKey] = { name: layerName, url: layerUrl };
      }
    }
    layer.on("click", onLayerClick)
    if (return_on_hover) {
      layer.on("mouseover", onLayerClick)
    }
  }
  map.on("draw:created", onCreate)
  map.on("draw:edited", onLayerClick)
  map.on("draw:deleted", onLayerClick)

  Streamlit.setFrameHeight(global_data.height);
  updateComponentValue(map)
}

/**
 * The component's render function. This will be called immediately after
 * the component is initially loaded, and then again every time the
 * component gets new data from Python.
 */
async function onRender(event: Event) {
  // Get the RenderData from the event
  const data = (event as CustomEvent<RenderData>).detail

  const script: string = data.args["script"]
  const height: number = data.args["height"]
  const width: number = data.args["width"]
  const html: string = data.args["html"]
  const header: string = data.args["header"]

  const js_links: Array<string> = data.args["js_links"]
  const css_links: Array<string> = data.args["css_links"]
  const _default: any = data.args["default"]
  const zoom: any = data.args["zoom"]
  const center: any = data.args["center"]
  const return_on_hover: boolean = data.args["return_on_hover"]

  // load scripts
  const loadScripts = async () => {
    ignore_render = true;
    for (const link of js_links) {
      // use promise to load scripts synchronously
      await new Promise((resolve, reject) => {
        const script = document.createElement("script")
        script.src = link
        script.async = false
        script.onload = resolve
        script.onerror = reject
        window.document.body.appendChild(script)
      })
    }

    css_links.forEach((link) => {
      const linkTag = document.createElement("link")
      linkTag.rel = "stylesheet"
      linkTag.href = link
      window.document.head.appendChild(linkTag)
    })

    window.document.head.innerHTML += header;
  }

  // finalize rendering
  const finalizeOnRender = () => {
    /* if we don't have a map yet,
       we have an extra render event before
       we are initialized.
    */
    if (!window.map) return

    let view_changed = false
    let new_zoom = window.map.getZoom()
    if (zoom && zoom !== window.__GLOBAL_DATA__.last_zoom) {
      new_zoom = zoom
      window.__GLOBAL_DATA__.last_zoom = zoom
      view_changed = true
    }

    let new_center = window.map.getCenter()
    if (
      center &&
      JSON.stringify(center) !==
        JSON.stringify(window.__GLOBAL_DATA__.last_center)
    ) {
      new_center = center
      window.__GLOBAL_DATA__.last_center = center
      view_changed = true
    }

    if (view_changed) {
      window.map.setView(new_center, new_zoom)
    }
  }

  if (!window.map && !ignore_render) {
    // Only run this if the map hasn't already been created (and thus the global
    //data hasn't been initialized)
    const div1 = document.getElementById("map_div")
    const div2 = document.getElementById("map_div2")
    if (div2) {
      div2.style.height = `${height}px`
      div2.style.width = `${width}px`
    }
    if (div1) {
      div1.style.height = `${height}px`
      div1.style.width = `${width}px`

      // HACK -- update the folium-generated JS to add, most importantly,
      // the map to this global variable so that it can be used elsewhere
      // in the script.

      window.__GLOBAL_DATA__ = {
        last_object_clicked: null,
        last_object_clicked_tooltip: null,
        last_object_clicked_popup: null,
        all_drawings: null,
        last_active_drawing: null,
        zoom: null,
        previous_data: _default,
        last_zoom: null,
        last_center: null,
        selected_layers: {},
        height: height
      }
    }
    await loadScripts().then(() => {
      ignore_render = false;

        if (window.L && window.L.drawLocal) {
            Object.assign((window as any).L.drawLocal, {
                draw: {
                    toolbar: {
                        actions: {
                            title: 'Cancelar desenho',
                            text: 'Cancelar'
                        },
                        finish: {
                            title: 'Concluir desenho',
                            text: 'Concluir'
                        },
                        undo: {
                            title: 'Remover o último ponto desenhado',
                            text: 'Desfazer último ponto'
                        },
                        buttons: {
                            polyline: 'Desenhar linha',
                            polygon: 'Desenhar polígono',
                            rectangle: 'Desenhar retângulo',
                            circle: 'Desenhar círculo',
                            marker: 'Adicionar marcador',
                            circlemarker: 'Adicionar marcador circular'
                        }
                    },
                    handlers: {
                        circle: {
                            tooltip: { start: 'Clique e arraste para desenhar um círculo' },
                            radius: 'Raio'
                        },
                        circlemarker: {
                            tooltip: { start: 'Clique no mapa para adicionar um marcador circular' }
                        },
                        marker: {
                            tooltip: { start: 'Clique no mapa para adicionar um marcador' }
                        },
                        polygon: {
                            tooltip: {
                                start: 'Clique para começar a desenhar a forma',
                                cont: 'Clique para continuar desenhando',
                                end: 'Clique no ponto inicial para fechar a forma'
                            }
                        },
                        polyline: {
                            error: '<strong>Erro:</strong> as linhas não podem se cruzar!',
                            tooltip: {
                                start: 'Clique para começar a desenhar a linha',
                                cont: 'Clique para continuar desenhando a linha',
                                end: 'Clique no último ponto para finalizar a linha'
                            }
                        },
                        rectangle: {
                            tooltip: { start: 'Clique e arraste para desenhar um retângulo' }
                        },
                        simpleshape: {
                            tooltip: { end: 'Solte o mouse para finalizar o desenho' }
                        }
                    }
                },
                edit: {
                    toolbar: {
                        actions: {
                            save: { title: 'Salvar alterações', text: 'Salvar' },
                            cancel: { title: 'Cancelar edição, descartar alterações', text: 'Cancelar' },
                            clearAll: { title: 'Remover todas as camadas', text: 'Remover tudo' }
                        },
                        buttons: {
                            edit: 'Editar camadas',
                            editDisabled: 'Nenhuma camada para editar',
                            remove: 'Remover camadas',
                            removeDisabled: 'Nenhuma camada para remover'
                        }
                    },
                    handlers: {
                        edit: {
                            tooltip: {
                                text: 'Arraste os pontos ou marcadores para editar a forma.',
                                subtext: 'Clique em Cancelar para descartar as alterações'
                            }
                        },
                        remove: {
                            tooltip: { text: 'Clique em uma forma para removê-la' }
                        }
                    }
                }
            })
        }

      const render_script = document.createElement("script")
      if (!window.map) {
	/* first add the html elements as the scripts may
           refer to them */
        const html_div = document.createElement("div")
        html_div.innerHTML = html
        document.body.appendChild(html_div)

	/* now the script */
        render_script.innerHTML =
          script +
          `window.map = map_div; window.initComponent(map_div, ${return_on_hover});`
        document.body.appendChild(render_script)
      }
      finalizeOnRender()
    })
  }
  finalizeOnRender()
}

// Attach our `onRender` handler to Streamlit's render event.
Streamlit.events.addEventListener(Streamlit.RENDER_EVENT, onRender)

// Tell Streamlit we're ready to start receiving data. We won't get our
// first RENDER_EVENT until we call this function.
Streamlit.setComponentReady()

// Finally, tell Streamlit to update our initial height. We omit the
// `height` parameter here to have it default to our scrollHeight.
Streamlit.setFrameHeight()
