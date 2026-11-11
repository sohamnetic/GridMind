import type { ModuleInfo } from './modules'

/** Shown for modules whose build phase has not landed yet. */
export function ModulePlaceholder({ module }: { module: ModuleInfo }) {
  return (
    <section className="placeholder" aria-labelledby="module-title">
      <p className="eyebrow">
        Module {module.step} of 5 · Build phase {module.phase}
      </p>
      <h1 id="module-title">{module.name}</h1>
      <p className="lede">{module.role}</p>
      <dl className="facts">
        <div>
          <dt>Produces</dt>
          <dd>{module.output}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>Not built yet</dd>
        </div>
      </dl>
    </section>
  )
}
