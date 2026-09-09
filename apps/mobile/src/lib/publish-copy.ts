// Сборка текстов диалога публикации (docs/legal/consent-copy.md §3). Отдельный модуль, а не строки внутри
// экрана: подстановка вариантов («имени нет», «места нет») — единственное место, где текст согласия можно
// нечаянно обрезать, а экраны в этом проекте тестами не покрыты. Ревью потока E1 поймало ровно такой обрез:
// вариант без имени терял конец первого абзаца — фразу про точку на карте, то есть самое существенное из того,
// на что человек соглашается.
import { PUBLISH_DIALOG, PUBLISH_DIALOG_SHORT } from './consent';

/**
 * Упоминания имени, которые надо убрать, когда `display_name` не задан: первое — из полного текста §3a,
 * второе — из короткого §3b. Оба варианта иначе утверждали бы, что другим видно имя, которого нет.
 */
const NAME_CLAUSES: readonly (readonly [string, string])[] = [
  ['породу, тир и ваше имя', 'породу и тир'],
  ['тир, ваше имя и место', 'тир и место'],
];

/**
 * Замена упоминания имени — отдельным предложением в конец первого абзаца, а не вырезанием куска абзаца
 * (consent-copy.md §3a, сноска про имя). `PUBLISH_DIALOG.noNameNote` хранит ту же мысль в форме «хвост
 * фразы», непригодной для подстановки без потери текста — см. хвосты в docs/tasks/T6.1-E1-publish-card.md.
 */
const NO_NAME_SENTENCE = 'Имени у вас пока нет — находка будет без подписи. Имя можно задать в профиле.';

/** Карточка без гео: сервер публикацию разрешает, но на карте её не будет (T6.1-D, хвост 8). */
const NO_GEO_SENTENCE = 'У этой карточки нет места — она попадёт в общий список, но не появится на карте.';

export interface PublishDialogInput {
  /** Полный текст §3a уже показывали и человек его принял — дальше короткая версия §3b. */
  explained: boolean;
  hasName: boolean;
  hasGeo: boolean;
}

export interface DialogCopy {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
}

export function publishDialogCopy({ explained, hasName, hasGeo }: PublishDialogInput): DialogCopy {
  const v = explained ? PUBLISH_DIALOG_SHORT : PUBLISH_DIALOG;
  const paragraphs = v.body.split('\n\n');
  if (!hasName) {
    // Если формулировку в consent.ts поменяют, подстановка не сработает — тогда предложение просто
    // добавляется, ничего не вырезая: хуже стиль, но текст остаётся правдивым и полным.
    let first = paragraphs[0]!;
    for (const [from, to] of NAME_CLAUSES) first = first.replace(from, to);
    paragraphs[0] = `${first} ${NO_NAME_SENTENCE}`;
  }
  if (!hasGeo) paragraphs.push(NO_GEO_SENTENCE);
  return { title: v.title, body: paragraphs.join('\n\n'), confirm: v.confirm, cancel: v.cancel };
}
