/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {BindingType} from '../../src/expression_parser/ast';
import {Lexer} from '../../src/expression_parser/lexer';
import {Parser} from '../../src/expression_parser/parser';
import {HtmlParser} from '../../src/ml_parser/html_parser';
import {DEFAULT_INTERPOLATION_CONFIG} from '../../src/ml_parser/interpolation_config';
import * as t from '../../src/render3/r3_ast';
import {Render3ParseResult, htmlAstToRender3Ast} from '../../src/render3/r3_template_transform';
import {BindingParser} from '../../src/template_parser/binding_parser';
import {MockSchemaRegistry} from '../../testing';
import {unparse} from '../expression_parser/utils/unparser';


// Parse an html string to IVY specific info
function parse(html: string): Render3ParseResult {
  const htmlParser = new HtmlParser();

  const parseResult = htmlParser.parse(html, 'path:://to/template', true);

  if (parseResult.errors.length > 0) {
    const msg = parseResult.errors.map(e => e.toString()).join('\n');
    throw new Error(msg);
  }

  const htmlNodes = parseResult.rootNodes;
  const expressionParser = new Parser(new Lexer());
  const schemaRegistry = new MockSchemaRegistry(
      {'invalidProp': false}, {'mappedAttr': 'mappedProp'}, {'unknown': false, 'un-known': false},
      ['onEvent'], ['onEvent']);
  const bindingParser =
      new BindingParser(expressionParser, DEFAULT_INTERPOLATION_CONFIG, schemaRegistry, null, []);
  return htmlAstToRender3Ast(htmlNodes, bindingParser);
}

// Transform an IVY AST to a flat list of nodes to ease testing
class R3AstHumanizer implements t.Visitor<void> {
  result: any[] = [];

  visitElement(element: t.Element) {
    this.result.push(['Element', element.name]);
    this.visitAll([
      element.attributes,
      element.inputs,
      element.outputs,
      element.references,
      element.children,
    ]);
  }

  visitTemplate(template: t.Template) {
    this.result.push(['Template']);
    this.visitAll([
      template.attributes,
      template.inputs,
      template.references,
      template.variables,
      template.children,
    ]);
  }

  visitContent(content: t.Content) {
    this.result.push(['Content', content.selectorIndex]);
    t.visitAll(this, content.attributes);
  }

  visitVariable(variable: t.Variable) {
    this.result.push(['Variable', variable.name, variable.value]);
  }

  visitReference(reference: t.Reference) {
    this.result.push(['Reference', reference.name, reference.value]);
  }

  visitTextAttribute(attribute: t.TextAttribute) {
    this.result.push(['TextAttribute', attribute.name, attribute.value]);
  }

  visitBoundAttribute(attribute: t.BoundAttribute) {
    this.result.push([
      'BoundAttribute',
      attribute.type,
      attribute.name,
      unparse(attribute.value),
    ]);
  }

  visitBoundEvent(event: t.BoundEvent) {
    this.result.push([
      'BoundEvent',
      event.name,
      event.target,
      unparse(event.handler),
    ]);
  }

  visitText(text: t.Text) { this.result.push(['Text', text.value]); }

  visitBoundText(text: t.BoundText) { this.result.push(['BoundText', unparse(text.value)]); }

  private visitAll(nodes: t.Node[][]) { nodes.forEach(node => t.visitAll(this, node)); }
}

function expectFromHtml(html: string) {
  const res = parse(html);
  return expectFromR3Nodes(res.nodes);
}

function expectFromR3Nodes(nodes: t.Node[]) {
  const humanizer = new R3AstHumanizer();
  t.visitAll(humanizer, nodes);
  return expect(humanizer.result);
}

describe('R3 template transform', () => {
  describe('Nodes without binding', () => {
    it('should parse text nodes', () => {
      expectFromHtml('a').toEqual([
        ['Text', 'a'],
      ]);
    });

    it('should parse elements with attributes', () => {
      expectFromHtml('<div a=b></div>').toEqual([
        ['Element', 'div'],
        ['TextAttribute', 'a', 'b'],
      ]);
    });

    it('should parse ngContent', () => {
      const res = parse('<ng-content select="a"></ng-content>');
      expect(res.hasNgContent).toEqual(true);
      expect(res.ngContentSelectors).toEqual(['a']);
      expectFromR3Nodes(res.nodes).toEqual([
        ['Content', 1],
        ['TextAttribute', 'select', 'a'],
      ]);
    });

    it('should parse ngContent when it contains WS only', () => {
      expectFromHtml('<ng-content select="a">    \n   </ng-content>').toEqual([
        ['Content', 1],
        ['TextAttribute', 'select', 'a'],
      ]);
    });

    it('should parse ngContent regardless the namespace', () => {
      expectFromHtml('<svg><ng-content select="a"></ng-content></svg>').toEqual([
        ['Element', ':svg:svg'],
        ['Content', 1],
        ['TextAttribute', 'select', 'a'],
      ]);
    });
  });

  describe('Bound text nodes', () => {
    it('should parse bound text nodes', () => {
      expectFromHtml('{{a}}').toEqual([
        ['BoundText', '{{ a }}'],
      ]);
    });
  });

  describe('Bound attributes', () => {
    it('should parse mixed case bound properties', () => {
      expectFromHtml('<div [someProp]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'someProp', 'v'],
      ]);
    });

    it('should parse bound properties via bind- ', () => {
      expectFromHtml('<div bind-prop="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'prop', 'v'],
      ]);
    });

    it('should parse bound properties via {{...}}', () => {
      expectFromHtml('<div prop="{{v}}"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'prop', '{{ v }}'],
      ]);
    });

    it('should parse dash case bound properties', () => {
      expectFromHtml('<div [some-prop]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'some-prop', 'v'],
      ]);
    });

    it('should parse dotted name bound properties', () => {
      expectFromHtml('<div [d.ot]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'd.ot', 'v'],
      ]);
    });

    it('should normalize property names via the element schema', () => {
      expectFromHtml('<div [mappedAttr]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'mappedProp', 'v'],
      ]);
    });

    it('should parse mixed case bound attributes', () => {
      expectFromHtml('<div [attr.someAttr]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Attribute, 'someAttr', 'v'],
      ]);
    });

    it('should parse and dash case bound classes', () => {
      expectFromHtml('<div [class.some-class]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Class, 'some-class', 'v'],
      ]);
    });

    it('should parse mixed case bound classes', () => {
      expectFromHtml('<div [class.someClass]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Class, 'someClass', 'v'],
      ]);
    });

    it('should parse mixed case bound styles', () => {
      expectFromHtml('<div [style.someStyle]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Style, 'someStyle', 'v'],
      ]);
    });
  });

  describe('templates', () => {
    it('should support * directives', () => {
      expectFromHtml('<div *ngIf></div>').toEqual([
        ['Template'],
        ['TextAttribute', 'ngIf', ''],
        ['Element', 'div'],
      ]);
    });

    it('should support <ng-template>', () => {
      expectFromHtml('<ng-template></ng-template>').toEqual([
        ['Template'],
      ]);
    });

    it('should support <ng-template> regardless the namespace', () => {
      expectFromHtml('<svg><ng-template></ng-template></svg>').toEqual([
        ['Element', ':svg:svg'],
        ['Template'],
      ]);
    });

    it('should support reference via #...', () => {
      expectFromHtml('<ng-template #a></ng-template>').toEqual([
        ['Template'],
        ['Reference', 'a', ''],
      ]);
    });

    it('should support reference via ref-...', () => {
      expectFromHtml('<ng-template ref-a></ng-template>').toEqual([
        ['Template'],
        ['Reference', 'a', ''],
      ]);
    });

    it('should parse variables via let-...', () => {
      expectFromHtml('<ng-template let-a="b"></ng-template>').toEqual([
        ['Template'],
        ['Variable', 'a', 'b'],
      ]);
    });

    it('should parse attributes', () => {
      expectFromHtml('<ng-template k1="v1" k2="v2"></ng-template>').toEqual([
        ['Template'],
        ['TextAttribute', 'k1', 'v1'],
        ['TextAttribute', 'k2', 'v2'],
      ]);
    });

    it('should parse bound attributes', () => {
      expectFromHtml('<ng-template [k1]="v1" [k2]="v2"></ng-template>').toEqual([
        ['Template'],
        ['BoundAttribute', BindingType.Property, 'k1', 'v1'],
        ['BoundAttribute', BindingType.Property, 'k2', 'v2'],
      ]);
    });
  });

  describe('inline templates', () => {
    it('should support attribute and bound attributes', () => {
      expectFromHtml('<div *ngFor="item of items"></div>').toEqual([
        ['Template'],
        ['BoundAttribute', BindingType.Property, 'ngFor', 'item'],
        ['BoundAttribute', BindingType.Property, 'ngForOf', 'items'],
        ['Element', 'div'],
      ]);
    });

    it('should parse variables via let ...', () => {
      expectFromHtml('<div *ngIf="let a=b"></div>').toEqual([
        ['Template'],
        ['TextAttribute', 'ngIf', ''],
        ['Variable', 'a', 'b'],
        ['Element', 'div'],
      ]);
    });

    it('should parse variables via as ...', () => {
      expectFromHtml('<div *ngIf="expr as local"></div>').toEqual([
        ['Template'],
        ['BoundAttribute', BindingType.Property, 'ngIf', 'expr'],
        ['Variable', 'local', 'ngIf'],
        ['Element', 'div'],
      ]);
    });
  });

  describe('events', () => {
    it('should parse bound events with a target', () => {
      expectFromHtml('<div (window:event)="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundEvent', 'event', 'window', 'v'],
      ]);
    });

    it('should parse event names case sensitive', () => {
      expectFromHtml('<div (some-event)="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundEvent', 'some-event', null, 'v'],
      ]);
      expectFromHtml('<div (someEvent)="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundEvent', 'someEvent', null, 'v'],
      ]);
    });

    it('should parse bound events via on-', () => {
      expectFromHtml('<div on-event="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundEvent', 'event', null, 'v'],
      ]);
    });

    it('should parse bound events and properties via [(...)]', () => {
      expectFromHtml('<div [(prop)]="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'prop', 'v'],
        ['BoundEvent', 'propChange', null, 'v = $event'],
      ]);
    });

    it('should parse bound events and properties via bindon-', () => {
      expectFromHtml('<div bindon-prop="v"></div>').toEqual([
        ['Element', 'div'],
        ['BoundAttribute', BindingType.Property, 'prop', 'v'],
        ['BoundEvent', 'propChange', null, 'v = $event'],
      ]);
    });

    it('should report an error on empty expression', () => {
      expect(() => parse('<div (event)="">')).toThrowError(/Empty expressions are not allowed/);
      expect(() => parse('<div (event)="   ">')).toThrowError(/Empty expressions are not allowed/);
    });
  });

  describe('references', () => {
    it('should parse references via #...', () => {
      expectFromHtml('<div #a></div>').toEqual([
        ['Element', 'div'],
        ['Reference', 'a', ''],
      ]);
    });

    it('should parse references via ref-', () => {
      expectFromHtml('<div ref-a></div>').toEqual([
        ['Element', 'div'],
        ['Reference', 'a', ''],
      ]);
    });

    it('should parse camel case references', () => {
      expectFromHtml('<div #someA></div>').toEqual([
        ['Element', 'div'],
        ['Reference', 'someA', ''],
      ]);
    });
  });

  describe('ng-content', () => {
    it('should parse ngContent without selector', () => {
      const res = parse('<ng-content></ng-content>');
      expect(res.hasNgContent).toEqual(true);
      expect(res.ngContentSelectors).toEqual([]);
      expectFromR3Nodes(res.nodes).toEqual([
        ['Content', 0],
      ]);
    });

    it('should parse ngContent with a * selector', () => {
      const res = parse('<ng-content></ng-content>');
      const selectors = [''];
      expect(res.hasNgContent).toEqual(true);
      expect(res.ngContentSelectors).toEqual([]);
      expectFromR3Nodes(res.nodes).toEqual([
        ['Content', 0],
      ]);
    });

    it('should parse ngContent with a specific selector', () => {
      const res = parse('<ng-content select="tag[attribute]"></ng-content>');
      const selectors = ['', 'tag[attribute]'];
      expect(res.hasNgContent).toEqual(true);
      expect(res.ngContentSelectors).toEqual(['tag[attribute]']);
      expectFromR3Nodes(res.nodes).toEqual([
        ['Content', 1],
        ['TextAttribute', 'select', selectors[1]],
      ]);
    });

    it('should parse ngContent with a selector', () => {
      const res = parse(
          '<ng-content select="a"></ng-content><ng-content></ng-content><ng-content select="b"></ng-content>');
      const selectors = ['', 'a', 'b'];
      expect(res.hasNgContent).toEqual(true);
      expect(res.ngContentSelectors).toEqual(['a', 'b']);
      expectFromR3Nodes(res.nodes).toEqual([
        ['Content', 1],
        ['TextAttribute', 'select', selectors[1]],
        ['Content', 0],
        ['Content', 2],
        ['TextAttribute', 'select', selectors[2]],
      ]);
    });

    it('should parse ngProjectAs as an attribute', () => {
      const res = parse('<ng-content ngProjectAs="a"></ng-content>');
      expect(res.hasNgContent).toEqual(true);
      expect(res.ngContentSelectors).toEqual([]);
      expectFromR3Nodes(res.nodes).toEqual([
        ['Content', 0],
        ['TextAttribute', 'ngProjectAs', 'a'],
      ]);
    });
  });

  describe('Ignored elements', () => {
    it('should ignore <script> elements', () => {
      expectFromHtml('<script></script>a').toEqual([
        ['Text', 'a'],
      ]);
    });

    it('should ignore <style> elements', () => {
      expectFromHtml('<style></style>a').toEqual([
        ['Text', 'a'],
      ]);
    });
  });

  describe('<link rel="stylesheet">', () => {
    it('should keep <link rel="stylesheet"> elements if they have an absolute url', () => {
      expectFromHtml('<link rel="stylesheet" href="http://someurl">').toEqual([
        ['Element', 'link'],
        ['TextAttribute', 'rel', 'stylesheet'],
        ['TextAttribute', 'href', 'http://someurl'],
      ]);
      expectFromHtml('<link REL="stylesheet" href="http://someurl">').toEqual([
        ['Element', 'link'],
        ['TextAttribute', 'REL', 'stylesheet'],
        ['TextAttribute', 'href', 'http://someurl'],
      ]);
    });

    it('should keep <link rel="stylesheet"> elements if they have no uri', () => {
      expectFromHtml('<link rel="stylesheet">').toEqual([
        ['Element', 'link'],
        ['TextAttribute', 'rel', 'stylesheet'],
      ]);
      expectFromHtml('<link REL="stylesheet">').toEqual([
        ['Element', 'link'],
        ['TextAttribute', 'REL', 'stylesheet'],
      ]);
    });

    it('should ignore <link rel="stylesheet"> elements if they have a relative uri', () => {
      expectFromHtml('<link rel="stylesheet" href="./other.css">').toEqual([]);
      expectFromHtml('<link REL="stylesheet" HREF="./other.css">').toEqual([]);
    });
  });

  describe('ngNonBindable', () => {
    it('should ignore bindings on children of elements with ngNonBindable', () => {
      expectFromHtml('<div ngNonBindable>{{b}}</div>').toEqual([
        ['Element', 'div'],
        ['TextAttribute', 'ngNonBindable', ''],
        ['Text', '{{b}}'],
      ]);
    });

    it('should keep nested children of elements with ngNonBindable', () => {
      expectFromHtml('<div ngNonBindable><span>{{b}}</span></div>').toEqual([
        ['Element', 'div'],
        ['TextAttribute', 'ngNonBindable', ''],
        ['Element', 'span'],
        ['Text', '{{b}}'],
      ]);
    });

    it('should ignore <script> elements inside of elements with ngNonBindable', () => {
      expectFromHtml('<div ngNonBindable><script></script>a</div>').toEqual([
        ['Element', 'div'],
        ['TextAttribute', 'ngNonBindable', ''],
        ['Text', 'a'],
      ]);
    });

    it('should ignore <style> elements inside of elements with ngNonBindable', () => {
      expectFromHtml('<div ngNonBindable><style></style>a</div>').toEqual([
        ['Element', 'div'],
        ['TextAttribute', 'ngNonBindable', ''],
        ['Text', 'a'],
      ]);
    });

    it('should ignore <link rel="stylesheet"> elements inside of elements with ngNonBindable',
       () => {
         expectFromHtml('<div ngNonBindable><link rel="stylesheet">a</div>').toEqual([
           ['Element', 'div'],
           ['TextAttribute', 'ngNonBindable', ''],
           ['Text', 'a'],
         ]);
       });
  });
});