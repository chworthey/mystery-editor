import React from 'react';
import * as d3 from 'd3';
import * as yaml from 'js-yaml';
import * as monaco from 'monaco-editor';
import { MysterySchema } from './Models/MysteryModel';
import { SimulationNodeDatum, SimulationLinkDatum, min } from 'd3';

interface IError {
  errorTitle: string;
  errorMessage: string;
}

interface IMysteryState {
  errors: IError[];
}

interface IMysteryProps {
  yamlUrl: string;
}

interface GraphNode extends SimulationNodeDatum {
  Name: string;
  Complexity: number;
  Description: string;
  IsStart: boolean;
  IsEnd: boolean;
  Locked: boolean;
  IsRedHerring: boolean;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  IsKey: boolean;
  Description: string;
}

interface KeyInfo {
  Target: string;
  Description: string;
}

var svgPanZoom = require('svg-pan-zoom');

export class Mystery extends React.Component<IMysteryProps, IMysteryState> {
  ref: SVGGElement | null = null;
  editor: HTMLDivElement | null = null;
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  schemaValidator: any | null = null;
  currentDoc: MysterySchema | null = null;
  simulation: d3.Simulation<GraphNode, GraphLink> | null = null;
  linkSelection: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null = null;
  nodeSelection: d3.Selection<SVGImageElement, GraphNode, SVGGElement, unknown> | null = null;
  textSelection: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown> | null = null;
  linkMidpointSelection: d3.Selection<SVGImageElement, GraphLink, SVGGElement, unknown> | null = null;
  panZoom: any | null;

  constructor(props: IMysteryProps) {
    super(props);

    this.state = {
      errors: []
    };
  }

  validate = () => {
    if (!this.monacoEditor || !this.schemaValidator) {
      return;
    }

    const docText = this.monacoEditor.getValue();

    var errors: IError[] = [];

    try {
      const doc = yaml.safeLoad(docText);
      var valid = this.schemaValidator(doc);
      if (!valid) {
        (this.schemaValidator.errors as any[]).forEach(e => { errors.push({ errorTitle: e.schemaPath, errorMessage: e.message }) });
        this.currentDoc = null;
      }
      else {
        var schema: MysterySchema = {
          InitialInteractableId: '',
          FinalGoalId: '',
          Interactables: []
        };
        var assignedSchema = Object.assign(schema, doc);

        if (!assignedSchema) {
          return;
        }

        this.currentDoc = assignedSchema;
        if (!this.currentDoc) {
          return;
        }

        var ids = new Set<string>();

        // Duplicate id's
        var checkDuplFn = (id: string) => {
          if (ids.has(id)) {
            errors.push({
              errorTitle: 'Duplicate Id',
              errorMessage: `Id '${id}' already exists elseware in document.`
            });
          }
          else {
            ids.add(id);
          }
        };

        this.currentDoc.Interactables.forEach(i => {
          checkDuplFn(i.Id);
        });

        if (!ids.has(this.currentDoc.InitialInteractableId)) {
          errors.push({
            errorTitle: 'No Starting Interactable',
            errorMessage: 'Initial interactable specified by InitialInteractableId is not present in Interactables.'
          });
        }

        checkDuplFn(this.currentDoc.FinalGoalId);

        if (this.currentDoc.Keys) {
          this.currentDoc.Keys.forEach(k => {
            checkDuplFn(k.Id);
          })
        }

        // No goal
        if (errors.length === 0) {
          if (!this.currentDoc.Interactables.some(i => {
            return this.currentDoc && i.OnInteractionCompletion && i.OnInteractionCompletion.includes(this.currentDoc.FinalGoalId);
          })) {
            errors.push({
              errorTitle: 'No Goal',
              errorMessage: 'No interactables list FinalGoalId as an interaction completion.'
            });
          }
        }

        // References to id's that do not exist
        if (errors.length === 0) {
          var keyIds = new Set<string>();
          if (this.currentDoc.Keys) {
            this.currentDoc.Keys.forEach(k => {
              keyIds.add(k.Id);
            });
          }
          this.currentDoc.Interactables.forEach(i => {
            if (i.KeysRequired) {
              i.KeysRequired.forEach(k => {
                if (!keyIds.has(k)) {
                  errors.push({
                    errorTitle: 'Dangling Reference',
                    errorMessage: `Interactable '${i.Id}' references key '${k}' in keys required which does not exist.`
                  });
                }
              });
            }
            if (i.OnInteractionCompletion) {
              i.OnInteractionCompletion.forEach(ic => {
                if (!ids.has(ic)) {
                  errors.push({
                    errorTitle: 'Dangling Reference',
                    errorMessage: `Interactable '${i.Id}' references '${ic}' in interaction completion which does not exist.`
                  });
                }
              });
            }
          });
        }

        // Island detection (things that exist but are not referenced in some way)
        if (errors.length === 0) {
          var refIds = new Set<string>();
          refIds.add(this.currentDoc.InitialInteractableId);
          this.currentDoc.Interactables.forEach(i => {
            if (i.OnInteractionCompletion) {
              i.OnInteractionCompletion.forEach(ic => {
                refIds.add(ic);
              });
            }
          });

          var islandCheckFn = (id: string) => {
            if (!refIds.has(id)) {
              errors.push({
                errorTitle: 'No reference',
                errorMessage: `There is no reference to item '${id}' currently`
              });
            }
          };

          if (this.currentDoc.Keys) {
            this.currentDoc.Keys.forEach(k => {
              islandCheckFn(k.Id);
            });
          }

          this.currentDoc.Interactables.forEach(i => {
            islandCheckFn(i.Id);
          });
        }
      }
    }
    catch(e) {
      if (e instanceof yaml.YAMLException) {
        var ex = e as yaml.YAMLException;
        errors.push({
          errorTitle: 'YAML parsing exception',
          errorMessage: ex.message
        });
      }
      else {
        errors.push({
          errorTitle: 'Unknown error',
          errorMessage: 'Exception thrown of unexpected type.'
        });
        console.log(e);
      }
    }

    this.setState({
      errors: errors
    });
  }

  updateDimensions = () => {
    if (this.monacoEditor && this.editor) {
      this.monacoEditor.layout({ width: this.editor.clientWidth, height: this.editor.clientHeight});
    }

    if (this.panZoom) {
      this.panZoom.resize();
    }
  };

  componentWillUnmount() {
    window.removeEventListener('resize', this.updateDimensions);
  }

  dragstarted = (d: GraphNode) => {

    if (!this.simulation) {
      return;
    }

    if (!d3.event.active) {
      this.simulation.alphaTarget(0.3).restart();
    }
    d.fx = d.x;
    d.fy = d.y;
  }
  
  dragged = (d: GraphNode) => {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
  }
  
  dragended = (d: GraphNode) => {
    if (!this.simulation) {
      return;
    }

    if (!d3.event.active) {
      this.simulation.alphaTarget(0);
    }
    d.fx = null;
    d.fy = null;
  }

  ticked = () => {    
    if (!this.linkSelection || !this.nodeSelection || !this.textSelection || !this.linkMidpointSelection) {
      return;
    }

    this.linkSelection
      .attr("x1", (d: GraphLink) => { var r = (d.source as GraphNode).x; return r ? r : 0; })
      .attr("y1", (d: GraphLink) => { var r = (d.source as GraphNode).y; return r ? r : 0; })
      .attr("x2", (d: GraphLink) => { var r = (d.target as GraphNode).x; return r ? r : 0; })
      .attr("y2", (d: GraphLink) => { var r = (d.target as GraphNode).y; return r ? r : 0; });

    this.nodeSelection
      .attr("x", (d) => { var r = (d as GraphNode).x; return r ? r - 32 : 0; })
      .attr("y", (d) => { var r = (d as GraphNode).y; return r ? r - 32 : 0; });

    this.textSelection
      .attr("x", (d) => { var r = (d as GraphNode).x;  return r ? r + 20 : 0; })
      .attr("y", (d) => { var r = (d as GraphNode).y ; return r ? r - 20 : 0; });

    this.linkMidpointSelection
      .attr("x", (d: GraphLink) => { 
        var r1 = (d.source as GraphNode).x; 
        var r2 = (d.target as GraphNode).x;
        if (!r1 || !r2) { return 0; } 
        return ((r1 + r2) / 2.0) - 16; 
      })
      .attr("y", (d: GraphLink) => { 
        var r1 = (d.source as GraphNode).y; 
        var r2 = (d.target as GraphNode).y; 
        if (!r1 || !r2) { return 0; } 
        return ((r1 + r2) / 2.0) - 16; 
      });
  }

  attachDiagram = () => {
    if (!this.currentDoc || !this.ref) {
      return;
    }

    var nodes: GraphNode[];
    var links: GraphLink[] = [];

    try {
      nodes = this.currentDoc.Interactables.map(i => {
        return {
          Name: i.Id,
          Complexity: i.ComplexityScore ? i.ComplexityScore : 1,
          IsStart: this.currentDoc ? this.currentDoc.InitialInteractableId === i.Id : false,
          IsEnd: false,
          Description: i.Description ? i.Description : 'No description',
          Locked: i.KeysRequired ? (i.KeysRequired.length > 0) : false,
          IsRedHerring: i.OnInteractionCompletion ? (i.OnInteractionCompletion.length === 0) : true
        };
      });
      nodes.push({
        Name: this.currentDoc.FinalGoalId,
        Complexity: 1,
        IsStart: false,
        IsEnd: true,
        Description: 'End of mystery',
        Locked: false,
        IsRedHerring: false
      });

      var keyDescriptionById = new Map<string, string>();
      if (this.currentDoc.Keys) {
        this.currentDoc.Keys.forEach(k => {
          keyDescriptionById.set(k.Id, k.Description ? k.Description : 'No description');
        });
      }

      var interactablesByKey = new Map<string, KeyInfo[]>();
      this.currentDoc.Interactables.forEach(i => {
        if (i.KeysRequired) {
          i.KeysRequired.forEach(k => {
            var pre = interactablesByKey.get(k);
            var desc = keyDescriptionById.get(k);
            if (pre) {
              pre.push({
                Target: i.Id,
                Description: desc ? desc : 'No description'});
            }
            else {
              interactablesByKey.set(k, [{Target: i.Id, Description: desc ? desc : 'No description'}]);
            }
          });
        }
      });

      this.currentDoc.Interactables.forEach(i => {

        if (!i.OnInteractionCompletion) {
          return;
        }

        i.OnInteractionCompletion.forEach(ic => {
          var isKey = false;
          var linkedKeyInteractables = interactablesByKey.get(ic);
          if (linkedKeyInteractables) {
            isKey = true;
          }

          if (!isKey) {
            links.push({
              IsKey: false,
              Description: 'Arrow indicates a reveal upon interaction completion',
              source: i.Id,
              target: ic
            });
          }
          else {
            if (linkedKeyInteractables) {
              links = links.concat(linkedKeyInteractables.map(ifk => {
                return {
                  IsKey: true,
                  Description: ifk.Description,
                  source: i.Id,
                  target: ifk.Target
                };
              }));
            }
          }
        });
      });
    }
    catch (e) {
      return;
    }

    if (this.linkMidpointSelection) {
      this.linkMidpointSelection.remove();
    }

    if (this.textSelection) {
      this.textSelection.remove();
    }

    if (this.nodeSelection) {
      this.nodeSelection.remove();
    }

    if (this.linkSelection) {
      this.linkSelection.remove();
    }

    if (this.simulation) {
      this.simulation.nodes();
      this.simulation.stop();
    }

    var svg = d3.select(this.ref);

    this.simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: SimulationNodeDatum) => {
        return (d as GraphNode).Name;
      }))
      .force("charge", d3.forceManyBody().strength(-10000))
      .force("center", d3.forceCenter(500, 500));

    this.linkSelection = svg
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke", "gray")
      .attr("stroke-width", 1)
      .attr("marker-end", "url(#arrow)");

    this.linkSelection.exit().remove();

    this.nodeSelection = svg
      .selectAll(".node")
      .data(nodes)
      .enter()
      .append("image")
      .attr("class", "node")
      .attr("href", (d: GraphNode) => {
        if (d.IsStart) {
          return '/graph/star.png';
        }
        if (d.IsEnd) {
          return '/graph/trophy.png';
        }
        if (d.IsRedHerring) {
          return '/graph/red-herring.png';
        }

        if (d.Locked) {
          return d.Complexity > 1 ? '/graph/locked-puzzle.png' : '/graph/lock.png';
        }
        else {
          return d.Complexity > 1 ? '/graph/puzzle.png' : '/graph/button.png';
        }
      })
      .attr("width", 64).attr("height", 64)
      .call(d3.drag<SVGImageElement, GraphNode>()
        .on("start", this.dragstarted)
        .on("drag", this.dragged)
        .on("end", this.dragended));

    this.nodeSelection.exit().remove();

    this.nodeSelection.append("title")
      .text((d: GraphNode) => {
        return d.Description;
      });

    this.textSelection = svg
      .selectAll("text")
      .data(nodes)
      .enter()
      .append("text")
      .attr("font-weight", "bold")
      .text((d: GraphNode) => {
        return d.Name;
      });
    
    this.textSelection.exit().remove();

    this.linkMidpointSelection = svg
      .selectAll(".linkmid")
      .data(links)
      .enter()
      .append("image")
      .attr("class", "linkmid")
      .attr("href", (d: GraphLink) => {
        return d.IsKey ? "/graph/key.png" : "/graph/eye.png";
      })
      .attr("width", 32).attr("height", 32);
    
    this.linkMidpointSelection.exit().remove();

    this.linkMidpointSelection.append("title")
      .text((d: GraphLink) => {
        return d.Description;
      });

    this.simulation
      .on("tick", this.ticked);

    this.panZoom.center();
    
    var clamp = (l: number, mn: number, mx: number) => {
      if (l < mn) {
        return mn;
      }
      if (l > mx) {
        return mx;
      }
      return l;
    }

    this.panZoom.zoom((1.0 - clamp(nodes.length / 30.0, 0.0, 1.0)) * (1.0 - 0.1) + 0.1);
  }

  componentDidMount() {
    window.addEventListener('resize', this.updateDimensions);
    this.panZoom = svgPanZoom('#nodegraph', {
      zoomEnabled: true,
      controlIconsEnabled: true,
      minZoom: 0.1,
      maxZoom: 2.0
    });

    fetch(this.props.yamlUrl).then(r => {
      r.text().then(t => {
        if (this.editor) {
          this.monacoEditor = monaco.editor.create(this.editor, {
            value: t,
            language: 'yaml',
            fontSize: 11,
            lineDecorationsWidth: 1,
            lineNumbersMinChars: 2
          });
          this.monacoEditor.onDidChangeModelContent((e) => {
            this.validate();

            this.attachDiagram();
          });
        }

        fetch('/mysteries/mystery.schema.json').then(r2 => {
          r2.json().then(j => {
            var Ajv = require('ajv');
            var ajv = new Ajv();
            this.schemaValidator = ajv.compile(j);
            this.validate();

            this.attachDiagram();
          });
        });
      });
    });
  }

  render() {
    return (
      <div>
        <div style={{display: 'flex', height: 'calc(100vh - 60px)'}}>
          <div ref={(ref: HTMLDivElement) => this.editor = ref} id="texteditor" style={{width: '100%', margin: '1px', flex: '1 auto', border: '1px solid #e8e8e8', textAlign: 'left', overflow: 'auto'}}/>
          {this.state.errors.length > 0 ? 
            <div style={{width: '100%', margin: '1px', padding: '10px', flex: '1 auto', border: '1px solid #e8e8e8', textAlign: 'left', overflow: 'auto'}}>
              <h1 style={{color: 'red'}}>Errors Occured:</h1>
              <ul style={{listStyleType: 'none'}}>
                {this.state.errors.map((i, index) => 
                  <li key={index} style={{border: '3px solid red', borderRadius: '10px', margin: '5px', backgroundColor: '#ffcccc', overflowWrap: 'break-word', wordWrap: 'break-word', padding: '20px'}}>
                    <h2>Error: {i.errorTitle}</h2>
                    <p style={{marginLeft: '5px'}}>Message: {i.errorMessage}</p>
                  </li>
                )}
              </ul>
            </div> :
            <svg id="nodegraph" viewBox="0 0 1000 1000" style={{width: '100%', margin: '1px', flex: '1 auto', border: '1px solid #e8e8e8'}}>
              <defs>
                <marker id="arrow" markerWidth="64" markerHeight="64" refX="60" refY="6" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,12 L32,6 z" fill="gray" />
                </marker>
              </defs>
              <g ref={(ref: SVGGElement) => this.ref = ref}>

              </g>
            </svg>
          }
        </div>
      </div>
    );
  }
}