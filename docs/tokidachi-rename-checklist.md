# Tokidachi rename checklist

The project may adopt Tokidachi (`token` + `-dachi`, inspired by *tomodachi*)
as its future name. Keep the rename separate from the extensible-provider and
companion work: changing the GNOME extension UUID creates a new extension
identity and requires a user migration.

The current pull request leaves every item below untouched:

- [ ] Rename `Gaalbu/ai-usage-widget` to `Gaalbu/tokidachi` on GitHub.
- [ ] Decide whether to change `ai-usage-widget@gaalbu.github.io` to
  `tokidachi@gaalbu.github.io` and document manual migration from the old UUID.
- [ ] Update `metadata.json`, Maven metadata, README, badges, install and
  uninstall scripts, configuration paths, and the extension directory name.
- [ ] Change the Codex app-server client name from `ai_usage_widget` if the new
  public identity is approved.
- [ ] Update release workflows and artifact names, preserving upgrade and
  download guidance for existing users.
- [ ] Announce the rename and migration path before publishing the new UUID.

GitHub redirects renamed repositories, but GNOME does not treat a new UUID as
an in-place update. That compatibility difference must drive the rollout.
