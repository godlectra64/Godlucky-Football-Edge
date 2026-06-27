alter table match_analysis
  add column if not exists pick_side text,
  add column if not exists pick_team text,
  add column if not exists pick_reason text;

update match_analysis
set
  pick_side = case
    when pick_side in ('HOME', 'AWAY', 'DRAW', 'NONE') then pick_side
    else 'NONE'
  end,
  pick_team = case
    when pick_side = 'DRAW' then 'เสมอ'
    when pick_side in ('HOME', 'AWAY') then pick_team
    else null
  end,
  pick_reason = coalesce(nullif(pick_reason, ''), 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ');

update match_analysis ma
set
  pick_side = case
    when ma.recommendation = 'NO BET' then 'NONE'
    when ma.risk_level = 'HIGH' then 'NONE'
    when ma.confidence_score < 58 then 'NONE'
    when
      (((ma.home_advantage_score - 50) * 0.55) +
       ((ma.away_weakness_score - 50) * 0.45) +
       ((ma.goal_scoring_score - 55) * 0.15) +
       ((ma.defensive_stability_score - 55) * 0.1) -
       (greatest(0, 55 - ma.market_risk_score) * 0.35)) >= 14
      and ma.home_advantage_score >= 62
      and ma.away_weakness_score >= 60
      and ma.market_risk_score >= 48
      then 'HOME'
    when
      (((50 - ma.home_advantage_score) * 0.7) +
       ((50 - ma.away_weakness_score) * 0.55) +
       ((ma.goal_scoring_score - 55) * 0.05) +
       ((ma.defensive_stability_score - 55) * 0.05) -
       (greatest(0, 55 - ma.market_risk_score) * 0.35)) >= 16
      and ma.home_advantage_score <= 42
      and ma.away_weakness_score <= 42
      and ma.market_risk_score >= 52
      then 'AWAY'
    else 'NONE'
  end,
  pick_team = case
    when ma.recommendation = 'NO BET' then null
    when ma.risk_level = 'HIGH' then null
    when ma.confidence_score < 58 then null
    when
      (((ma.home_advantage_score - 50) * 0.55) +
       ((ma.away_weakness_score - 50) * 0.45) +
       ((ma.goal_scoring_score - 55) * 0.15) +
       ((ma.defensive_stability_score - 55) * 0.1) -
       (greatest(0, 55 - ma.market_risk_score) * 0.35)) >= 14
      and ma.home_advantage_score >= 62
      and ma.away_weakness_score >= 60
      and ma.market_risk_score >= 48
      then ht.name
    when
      (((50 - ma.home_advantage_score) * 0.7) +
       ((50 - ma.away_weakness_score) * 0.55) +
       ((ma.goal_scoring_score - 55) * 0.05) +
       ((ma.defensive_stability_score - 55) * 0.05) -
       (greatest(0, 55 - ma.market_risk_score) * 0.35)) >= 16
      and ma.home_advantage_score <= 42
      and ma.away_weakness_score <= 42
      and ma.market_risk_score >= 52
      then at.name
    else null
  end,
  pick_reason = case
    when ma.recommendation = 'NO BET' then 'ไม่แนะนำเดิมพัน เพราะระบบประเมินว่ายังไม่มีความคุ้มค่าพอ'
    when ma.risk_level = 'HIGH' then 'ความเสี่ยงสูง จึงไม่แนะนำเลือกฝั่ง'
    when ma.confidence_score < 58 then 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ'
    when
      (((ma.home_advantage_score - 50) * 0.55) +
       ((ma.away_weakness_score - 50) * 0.45) +
       ((ma.goal_scoring_score - 55) * 0.15) +
       ((ma.defensive_stability_score - 55) * 0.1) -
       (greatest(0, 55 - ma.market_risk_score) * 0.35)) >= 14
      and ma.home_advantage_score >= 62
      and ma.away_weakness_score >= 60
      and ma.market_risk_score >= 48
      then 'เจ้าบ้านได้เปรียบชัดจากคะแนนเหย้าและความอ่อนแอของทีมเยือน'
    when
      (((50 - ma.home_advantage_score) * 0.7) +
       ((50 - ma.away_weakness_score) * 0.55) +
       ((ma.goal_scoring_score - 55) * 0.05) +
       ((ma.defensive_stability_score - 55) * 0.05) -
       (greatest(0, 55 - ma.market_risk_score) * 0.35)) >= 16
      and ma.home_advantage_score <= 42
      and ma.away_weakness_score <= 42
      and ma.market_risk_score >= 52
      then 'ทีมเยือนมีภาษีดีกว่าจากคะแนนฝั่งเจ้าบ้านที่อ่อนและทีมเยือนไม่เปราะชัด'
    else 'ข้อมูลยังไม่พอให้เลือกฝั่งอย่างมั่นใจ'
  end
from football_matches fm
left join football_teams ht on ht.id = fm.home_team_id
left join football_teams at on at.id = fm.away_team_id
where ma.match_id = fm.id;

alter table match_analysis
  drop constraint if exists match_analysis_pick_side_valid,
  drop constraint if exists match_analysis_pick_reason_required;

alter table match_analysis
  add constraint match_analysis_pick_side_valid check (pick_side is null or pick_side in ('HOME', 'AWAY', 'DRAW', 'NONE')),
  add constraint match_analysis_pick_reason_required check (pick_side is null or pick_side = 'NONE' or pick_reason is not null);
