/**
 * A minimal XML element tree and serializer. Modules build element trees,
 * never strings, so the pipeline can place and inspect what they return.
 */

export type AttrValue = string | number | boolean | null | undefined;

export interface XmlElement {
  kind: 'element';
  name: string;
  attrs: Record<string, AttrValue>;
  children: XmlNode[];
}

export interface XmlComment {
  kind: 'comment';
  text: string;
}

export interface XmlText {
  kind: 'text';
  text: string;
}

export type XmlNode = XmlElement | XmlComment | XmlText;

/** Anything accepted as a child: nodes, strings (text), nested arrays; falsy values are dropped. */
export type XmlChild = XmlNode | string | null | undefined | false | XmlChild[];

function flatten(children: XmlChild[], out: XmlNode[]): XmlNode[] {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) flatten(child, out);
    else if (typeof child === 'string') out.push({ kind: 'text', text: child });
    else out.push(child);
  }
  return out;
}

/** Create an element. Attributes with null/undefined values are omitted on output. */
export function el(name: string, attrs: Record<string, AttrValue> = {}, children: XmlChild[] = []): XmlElement {
  return { kind: 'element', name, attrs, children: flatten(children, []) };
}

/** Create a reference to an element defined elsewhere: `<name idref="id"/>`. */
export function ref(name: string, id: string): XmlElement {
  return el(name, { idref: id });
}

export function comment(text: string): XmlComment {
  return { kind: 'comment', text };
}

export function text(value: string): XmlText {
  return { kind: 'text', text: value };
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Format an attribute value. Arrays of numbers are written space-separated by callers via `formatNumbers`. */
export function formatAttr(value: Exclude<AttrValue, null | undefined>): string {
  return typeof value === 'string' ? value : String(value);
}

export function formatNumbers(value: number | number[]): string {
  return Array.isArray(value) ? value.join(' ') : String(value);
}

export interface SerializeOptions {
  indent?: string;
  /** Put an empty line between the children of the root element. */
  spaceTopLevel?: boolean;
}

export function serialize(root: XmlNode, options: SerializeOptions = {}): string {
  const indent = options.indent ?? '\t';
  const out: string[] = [];

  const write = (node: XmlNode, depth: number): void => {
    const pad = indent.repeat(depth);
    if (node.kind === 'comment') {
      // "--" is not allowed inside an XML comment
      out.push(`${pad}<!-- ${node.text.replace(/--/g, '- -')} -->`);
      return;
    }
    if (node.kind === 'text') {
      out.push(`${pad}${escapeText(node.text)}`);
      return;
    }
    let open = `${pad}<${node.name}`;
    for (const [key, value] of Object.entries(node.attrs)) {
      if (value === null || value === undefined) continue;
      open += ` ${key}="${escapeAttr(formatAttr(value))}"`;
    }
    if (node.children.length === 0) {
      out.push(`${open}/>`);
      return;
    }
    out.push(`${open}>`);
    node.children.forEach((child, i) => {
      if (depth === 0 && options.spaceTopLevel && i > 0) out.push('');
      write(child, depth + 1);
    });
    out.push(`${pad}</${node.name}>`);
  };

  write(root, 0);
  return out.join('\n');
}
