-- =============================================================================
-- JibonJori - 0008 reference data
-- =============================================================================
-- The controlled vocabulary the profile forms depend on. Values are carried over
-- unchanged from the previous seed so the published tiers and labels keep the
-- same meaning in the compatibility scorer.
--
-- Idempotent: re-running updates the label and tier in place rather than
-- duplicating. `curated_videos` is intentionally NOT seeded - curated content is
-- authored by an administrator, and inventing video ids here would be
-- fabricating content that nobody has reviewed.
-- =============================================================================

insert into public.education_levels (slug, label, tier) values
  ('below-secondary',   'Below Secondary',                      0),
  ('secondary',         'Secondary (SSC/O-level)',              1),
  ('higher-secondary',  'Higher Secondary (HSC/A-level)',       2),
  ('diploma',           'Diploma / Vocational',                 3),
  ('bachelor',          'Bachelor''s Degree',                   4),
  ('bachelor-honours',  'Bachelor''s Honours',                  5),
  ('master',            'Master''s Degree',                     6),
  ('doctorate',         'Doctorate (PhD / MD / equivalent)',    7)
on conflict (slug) do update set label = excluded.label, tier = excluded.tier;

insert into public.professions (slug, label, tier) values
  ('student',              'Student',                        0),
  ('homemaker',            'Homemaker',                      0),
  ('not-working',          'Not Currently Working',          0),
  ('self-employed',        'Self-Employed / Business',       1),
  ('farmer',               'Agriculture / Farming',          1),
  ('skilled-worker',       'Skilled Trades / Technician',    2),
  ('service',              'Government / Bank Service',      3),
  ('teacher',              'Teacher / Academic',             3),
  ('nurse',                'Nurse / Healthcare Worker',      3),
  ('engineer',             'Engineer',                       4),
  ('doctor',               'Doctor / Medical Professional',  4),
  ('it-professional',      'IT / Software Professional',     4),
  ('accountant',           'Accountant / Finance Professional', 4),
  ('lawyer',               'Legal Professional',             4),
  ('business-executive',   'Corporate / Management Professional', 5),
  ('professional-other',   'Other Professional',             4)
on conflict (slug) do update set label = excluded.label, tier = excluded.tier;

insert into public.interests (slug, label) values
  ('reading',            'Reading'),
  ('traveling',          'Traveling'),
  ('photography',        'Photography'),
  ('movies',             'Movies & TV'),
  ('sports',             'Sports & Fitness'),
  ('cricket',            'Cricket'),
  ('badminton',          'Badminton'),
  ('cycling',            'Cycling'),
  ('hiking',             'Hiking & Nature'),
  ('gardening',          'Gardening'),
  ('gaming',             'Gaming'),
  ('tech',               'Technology'),
  ('business',           'Entrepreneurship'),
  ('art',                'Art & Drawing'),
  ('writing',            'Writing'),
  ('fashion',            'Fashion'),
  ('food',               'Food & Dining'),
  ('spirituality',       'Spirituality'),
  ('family-time',        'Family Time'),
  ('language-learning',  'Language Learning'),
  ('volunteering',       'Volunteering'),
  ('cooking',            'Cooking'),
  ('music',              'Music'),
  ('singing',            'Singing')
on conflict (slug) do update set label = excluded.label;
