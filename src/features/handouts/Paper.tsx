/** Ein Handout auf Papier – für die Vorschau und für den Druck. */
import { paragraphs, sealMark } from '../../domain/handout';
import type { HandoutKind } from '../../domain/schema';
import { cx } from '../../ui';

export function Paper({
  kind,
  title,
  text,
  signature,
  seal,
}: {
  kind: HandoutKind;
  title: string;
  text: string;
  signature: string;
  seal: string;
}) {
  const mark = sealMark(seal);
  return (
    <article className={cx('wf-handout-paper', `wf-handout-paper--${kind}`)}>
      {kind === 'decree' && title.trim() && <h2 className="wf-handout-paper__title">{title}</h2>}
      <div className="wf-handout-paper__text">
        {paragraphs(text).map((part, index) => (
          <p key={index}>{part}</p>
        ))}
      </div>
      {(signature.trim() || mark) && (
        <footer className="wf-handout-paper__foot">
          {signature.trim() && <span className="wf-handout-paper__sign">{signature}</span>}
          {mark && (
            <span className="wf-handout-paper__seal" aria-label={`Siegel ${mark}`}>
              {mark}
            </span>
          )}
        </footer>
      )}
    </article>
  );
}
