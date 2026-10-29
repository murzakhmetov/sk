# Комплект для хакатона

Это папка подготовки к хакатону, кода решения здесь нет. Сроки, правила и способ оценки — в `.claude/context/hackathon.md` (если там TODO, начни с `/hackathon-setup`), план — в `PLAYBOOK.md`.

- Спонсора исследуем через `/sponsor-brief`, бриф кладём в `.claude/context/<спонсор>.md`.
- Кейс разбираем через `/case-breakdown`. Результаты кладём в `cases/<slug>/` (`CASE.md`, `BREAKDOWN.md`, `SPEC.md`).
- Проекты создаёт `/kickoff` через `scripts/new-project.sh` в `projects/<имя>/`. У каждого проекта свой git и свой `CLAUDE.md` с правилами режима хакатона (копия `harness/CLAUDE.md`).
- `templates/` меняем только сознательно: это общая база для будущих проектов.
- Отвечай на языке пользователя.
