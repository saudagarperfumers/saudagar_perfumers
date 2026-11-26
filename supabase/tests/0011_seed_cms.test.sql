-- CMS content: the store's pages and site text are present and readable by visitors, whatever the owner has written.
-- (The content itself came from the old site in phase 28; see scripts/old-site/.)
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare
  home jsonb := public.page_content('home');
  boot jsonb := public.site_bootstrap();
  s text;
begin
  assert jsonb_array_length(home -> 'sections') > 0, 'home has sections';
  assert home -> 'sections' -> 0 ->> 'type' = 'hero_video_carousel', 'home starts with the hero';
  assert public.page_content('boutiques') is null, 'boutiques page is hidden from visitors';
  foreach s in array array['shipping-policy', 'returns-policy', 'privacy-policy', 'terms', 'contact'] loop
    assert public.page_content(s) ->> 'layout' = 'rich_text', format('%s page exists', s);
    assert length(coalesce(public.page_content(s) ->> 'body', '')) > 100, format('%s page has its text', s);
  end loop;
  assert (boot -> 'blocks') ?& array['brand', 'theme', 'seo', 'mega_nav', 'mobile_drawer', 'footer', 'announcement_bar', 'stories_viewer'], 'every block is in the bootstrap';
end $$;
reset role;
