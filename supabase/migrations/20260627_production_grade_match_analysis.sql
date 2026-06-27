update match_analysis
set
  team_strength_score = coalesce(team_strength_score, 56),
  form_score = coalesce(form_score, 56),
  home_advantage_score = coalesce(home_advantage_score, home_away_score, 56),
  away_weakness_score = coalesce(away_weakness_score, 55),
  goal_scoring_score = coalesce(goal_scoring_score, goal_quality_score, 56),
  defensive_stability_score = coalesce(defensive_stability_score, 56),
  motivation_score = coalesce(motivation_score, 56),
  market_risk_score = coalesce(market_risk_score, risk_score, market_context_score, 52),
  confidence_score = coalesce(confidence_score, 0),
  recommendation = case
    when upper(coalesce(recommendation, '')) = 'BET' then 'BET'
    when upper(coalesce(recommendation, '')) = 'LEAN' then 'LEAN'
    else 'NO BET'
  end,
  risk_level = case
    when upper(coalesce(risk_level, '')) = 'LOW' then 'LOW'
    when upper(coalesce(risk_level, '')) = 'HIGH' then 'HIGH'
    else 'MEDIUM'
  end,
  analysis_summary = coalesce(nullif(analysis_summary, ''), nullif(thai_reason, ''), 'แนะนำ NO BET เพราะข้อมูลวิเคราะห์เดิมยังไม่ครบ ควรรอข้อมูลตลาดและทีมก่อนตัดสินใจ'),
  thai_reason = coalesce(nullif(thai_reason, ''), nullif(analysis_summary, ''), 'แนะนำ NO BET เพราะข้อมูลวิเคราะห์เดิมยังไม่ครบ ควรรอข้อมูลตลาดและทีมก่อนตัดสินใจ');

alter table match_analysis
  alter column analysis_summary set default 'แนะนำ NO BET เพราะข้อมูลวิเคราะห์ยังจำกัด ควรรอข้อมูลเพิ่มก่อนตัดสินใจ',
  alter column analysis_summary set not null,
  alter column confidence_score set default 0,
  alter column confidence_score set not null,
  alter column recommendation set default 'NO BET',
  alter column recommendation set not null,
  alter column risk_level set default 'MEDIUM',
  alter column risk_level set not null,
  alter column home_advantage_score set default 56,
  alter column home_advantage_score set not null,
  alter column away_weakness_score set default 55,
  alter column away_weakness_score set not null,
  alter column goal_scoring_score set default 56,
  alter column goal_scoring_score set not null,
  alter column defensive_stability_score set default 56,
  alter column defensive_stability_score set not null,
  alter column market_risk_score set default 52,
  alter column market_risk_score set not null;

alter table match_analysis
  drop constraint if exists match_analysis_recommendation_valid,
  drop constraint if exists match_analysis_risk_level_valid,
  drop constraint if exists match_analysis_confidence_range,
  drop constraint if exists match_analysis_required_scores_range;

alter table match_analysis
  add constraint match_analysis_recommendation_valid check (recommendation in ('BET', 'LEAN', 'NO BET')),
  add constraint match_analysis_risk_level_valid check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  add constraint match_analysis_confidence_range check (confidence_score between 0 and 100),
  add constraint match_analysis_required_scores_range check (
    home_advantage_score between 0 and 100 and
    away_weakness_score between 0 and 100 and
    goal_scoring_score between 0 and 100 and
    defensive_stability_score between 0 and 100 and
    market_risk_score between 0 and 100
  );
