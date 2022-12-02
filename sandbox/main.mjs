/* eslint-disable */

import {
  h,
  html,
  render,
  useEffect,
  useState,
  useRef,
} from 'https://esm.sh/htm@3.1.1/preact/standalone.module.js';
import * as rq from '/dist/@patdx/rqlite-js/index.js';

const useQuery = (fn, deps) => {
  const [rerender, setRerender] = useState({});
  const [val, setVal] = useState();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fn();
      if (!cancelled) {
        setVal(result);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rerender, ...(deps ?? [])]);

  return {
    data: val,
    refetch: () => {
      setRerender({});
      setVal(undefined);
    },
  };
};

console.log(`window.rq = rq`);
window.rq = rq;
const client = new rq.DataApiClient('http://localhost:8080', {
  auth: { username: 'user', password: 'pass' },
  headers: {
    'x-database-url': 'hello-world',
  },
});
console.log(`window.c = client`);
window.c = client;

const App = () => {
  const inputRef = useRef();
  const [query, setQuery] = useState(`select * from x`);
  const result = useQuery(() => client.query(query), [query]);

  const handleSubmit = () => {
    setQuery(inputRef.current.value);
    result.refetch();
  };

  return html`
    <div>Query result:</div>
    <form
      style="display: flex; flex-direction: column; gap: 8px;"
      onSubmit=${(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      <textarea
        ref=${inputRef}
        defaultValue=${query}
        rows="6"
        onKeyDown=${(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            (event.keyCode == 13 || event.keyCode == 10)
          ) {
            handleSubmit();
          }
        }}
      />
      <div>Press Ctrl+Enter or Command+Enter to run query</div>
      <button type="submit">Run query</button>
      <button
        type="button"
        onClick=${async () => {
          const { format } = await import(
            'https://esm.sh/sql-formatter@12.0.3'
          );
          inputRef.current.value = format(inputRef.current.value, {
            language: 'sqlite',
            tabWidth: 2,
            keywordCase: 'upper',
          });
        }}
      >
        Format query
      </button>
    </form>
    <pre>${JSON.stringify(result.data, undefined, 2)}</pre>
  `;
};

render(h(App), document.body);
