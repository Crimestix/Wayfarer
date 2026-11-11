/**
 * Nachschlagen, ohne den Spieltisch zu verlassen: der Artikel zum Ort und die Karte, auf der die
 * Gruppe steht, als Fenster über dem Tisch.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Library } from 'lucide-react';
import { useData } from '../../data/hooks';
import { Button, Dialog, cx, toast } from '../../ui';
import type { OpenTarget } from '../legendkeeper/Article';
import { LocalArticle } from '../wiki/LocalArticle';
import { MapView } from '../wiki/MapView';
import type { PlaceMap } from './wiki';

/** Ein Artikel zum Lesen; Verweise darin blättern im selben Fenster weiter. */
export function ArticleDialog({
  articleId,
  onClose,
}: {
  /** Der Artikel, mit dem das Fenster aufgeht; null = geschlossen. */
  articleId: string | null;
  onClose: () => void;
}) {
  const data = useData();
  const [, navigate] = useLocation();
  /** Artikel, zu denen von dort aus weitergeblättert wurde. */
  const [trail, setTrail] = useState<string[]>([]);
  useEffect(() => setTrail([]), [articleId]);

  const currentId = trail[trail.length - 1] ?? articleId;
  const article = currentId ? data.articles[currentId] : undefined;
  const articles = data.articles;
  const onOpen = useCallback(
    (target: OpenTarget) => {
      if (articles[target.resourceId]) setTrail((t) => [...t, target.resourceId]);
      else if (!target.resourceId)
        toast({ title: `„${target.wanted ?? target.title}“ hat noch keinen Artikel` });
      else toast({ title: `„${target.title || 'Dieser Artikel'}“ gibt es im Wiki nicht` });
    },
    [articles],
  );

  return (
    <Dialog
      open={articleId !== null && article !== undefined}
      onClose={onClose}
      guard={false}
      title="Aus dem Wiki"
      width={1080}
    >
      {article && (
        <div className="wf-lk wf-tisch-peek">
          <LocalArticle
            key={article.id}
            article={article}
            onOpen={onOpen}
            actions={
              <>
                {trail.length > 0 && (
                  <Button
                    size="sm"
                    icon={<ArrowLeft />}
                    onClick={() => setTrail((t) => t.slice(0, -1))}
                    aria-label="Zurück"
                  >
                    <span className="wf-lk-act__label">Zurück</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  icon={<Library />}
                  onClick={() => {
                    onClose();
                    navigate(`/wiki/${article.id}`);
                  }}
                  title="Diesen Artikel im Wiki öffnen"
                  aria-label="Im Wiki öffnen"
                >
                  <span className="wf-lk-act__label">Im Wiki öffnen</span>
                </Button>
              </>
            }
          />
        </div>
      )}
    </Dialog>
  );
}

/** Die Karten zum Ort der Gruppe: der Ort selbst und seine Umgebung. */
export function MapDialog({
  maps,
  open,
  onClose,
}: {
  maps: PlaceMap[];
  open: boolean;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    if (open) setChosen(null);
  }, [open]);
  const current = maps.find((entry) => entry.map.id === chosen) ?? maps[0];

  return (
    <Dialog
      open={open && current !== undefined}
      onClose={onClose}
      guard={false}
      title={current ? current.map.name : 'Karte'}
      width={1180}
    >
      {current && (
        <div className="wf-tisch-peek wf-tisch-peek--map">
          {maps.length > 1 && (
            <div className="wf-lk-pages" role="tablist" aria-label="Karten">
              {maps.map((entry) => (
                <button
                  key={entry.map.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.map.id === current.map.id}
                  className={cx(!entry.own && 'wf-tisch-peek__around')}
                  onClick={() => setChosen(entry.map.id)}
                  title={entry.own ? undefined : `Umgebung: ${entry.of.name}`}
                >
                  {entry.map.name}
                </button>
              ))}
            </div>
          )}
          <MapView key={current.map.id} map={current.map} onLeave={onClose} />
        </div>
      )}
    </Dialog>
  );
}
