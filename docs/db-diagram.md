# Database Schema (DBML)

Paste into [dbdiagram.io](https://dbdiagram.io/home) to render the ERD.

```dbml
// Social Listening Platform — BigQuery Schema
// Dataset: social_listening

Table collections {
  collection_id varchar [pk, not null]
  user_id varchar [not null]
  org_id varchar
  session_id varchar
  original_question varchar [not null]
  config json [not null]
  created_at timestamp
}

Table posts {
  post_id varchar [pk, not null]
  collection_id varchar [not null]
  platform varchar [not null]
  channel_handle varchar
  channel_id varchar
  title varchar
  content varchar
  post_url varchar
  posted_at timestamp
  post_type varchar
  parent_post_id varchar
  media_refs json
  platform_metadata json
  crawl_provider varchar
  search_keyword varchar
  collected_at timestamp
}

Table channels {
  channel_id varchar [pk, not null]
  collection_id varchar [not null]
  platform varchar [not null]
  channel_handle varchar [not null]
  subscribers bigint
  total_posts bigint
  channel_url varchar
  description varchar
  created_date timestamp
  channel_metadata json
  observed_at timestamp
}

Table enriched_posts {
  post_id varchar [pk, not null]
  sentiment varchar
  emotion varchar
  entities "array<varchar>"
  themes "array<varchar>"
  ai_summary varchar
  language varchar
  content_type varchar
  key_quotes "array<varchar>"
  custom_fields json
  enriched_at timestamp
}

Table post_engagements {
  engagement_id varchar [pk, not null]
  post_id varchar [not null]
  likes bigint
  shares bigint
  comments_count bigint
  views bigint
  saves bigint
  comments json
  platform_engagements json
  source varchar [not null]
  fetched_at timestamp
}

Table post_embeddings {
  post_id varchar [pk, not null]
  embedding "array<float>"
  embedding_model varchar
  embedded_at timestamp
}

Table usage_events {
  event_id varchar [pk, not null]
  event_type varchar [not null]
  user_id varchar [not null]
  org_id varchar
  session_id varchar
  collection_id varchar
  metadata json
  created_at timestamp
}

Table media_refs {
  post_id varchar [not null, note: 'derived from parent post']
  gcs_uri varchar
  media_type varchar [note: 'image, video, audio, unknown']
  content_type varchar [note: 'MIME type e.g. image/jpeg, video/mp4']
  original_url varchar
  size_bytes bigint
  error varchar [note: 'populated on download failure']

  Note: 'Embedded as JSON array in posts.media_refs'
}

// --- Relationships ---

Ref: posts.collection_id > collections.collection_id
Ref: posts.parent_post_id > posts.post_id
Ref: channels.collection_id > collections.collection_id
Ref: posts.channel_id > channels.channel_id
Ref: enriched_posts.post_id - posts.post_id
Ref: post_engagements.post_id > posts.post_id
Ref: post_embeddings.post_id - posts.post_id
Ref: usage_events.collection_id > collections.collection_id
Ref: usage_events.user_id > collections.user_id
Ref: media_refs.post_id > posts.post_id
```
