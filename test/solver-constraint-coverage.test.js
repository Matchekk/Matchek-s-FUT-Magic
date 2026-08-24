import test from "node:test";
import assert from "node:assert/strict";

import { buildSolverContext, solveSquad } from "../solver/solver.js";

const squadSize = { type:"players_in_squad", count:11, op:"exact", value:[11] };
const player = (index, overrides={}) => ({
  id:String(index+1), definitionId:1000+index, assetId:2000+index,
  rating:82, teamId:10+index, leagueId:20+index, nationId:30+index,
  rarityId:0, rarityName:"Common Gold", isSpecial:false,
  preferredPositionName:"CM", alternativePositionNames:["CM"],
  ...overrides,
});

const solve = (players, requirement, extra={}) => solveSquad(buildSolverContext({
  players,
  requirementsNormalized:[squadSize, requirement],
  requiredPlayers:11,
  optimize:{refineSolvedSquad:false,solverTimeBudgetMs:100},
  ...extra,
}));

const selected = (result, players) => {
  const byId=new Map(players.map((entry)=>[String(entry.id),entry]));
  return (result.solutions?.[0]||[]).map((id)=>byId.get(String(id)));
};

for (const [label,type,field,value] of [
  ["league","league_id","leagueId",99],
  ["nation","nation_id","nationId",88],
  ["club","club_id","teamId",77],
]) {
  test(`solver enforces minimum ${label} identity quotas`, () => {
    const players=Array.from({length:16},(_,index)=>player(index,index<3?{[field]:value}:{}));
    const result=solve(players,{type,count:3,op:"min",value:[value]});
    assert.equal(result.stats.solved,true);
    assert.ok(selected(result,players).filter((entry)=>entry[field]===value).length>=3);
  });
}

test("solver enforces minimum player rating quotas", () => {
  const players=Array.from({length:16},(_,index)=>player(index,index<11?{rating:86}:{}));
  const result=solve(players,{type:"player_min_ovr",count:11,op:"min",value:[85]});
  assert.equal(result.stats.solved,true);
  assert.equal(selected(result,players).filter((entry)=>entry.rating>=85).length,11);
});

test("solver enforces rare-card requirements without spending specials", () => {
  const players=Array.from({length:16},(_,index)=>player(index,index<4?{rarityId:1,rarityName:"Rare Gold"}:{}));
  const result=solve(players,{type:"player_rarity_group",count:4,op:"min",value:["rare"],label:"Rare players: Min. 4"});
  assert.equal(result.stats.solved,true);
  assert.equal(selected(result,players).filter((entry)=>entry.rarityName==="Rare Gold").length,4);
});

test("solver enforces required TOTW special cards", () => {
  const players=Array.from({length:16},(_,index)=>player(index,index===0?{rarityId:3,rarityName:"Team of the Week",isSpecial:true}:{}));
  const result=solve(players,{type:"player_inform",count:1,op:"min",value:[1]});
  assert.equal(result.stats.solved,true);
  assert.equal(selected(result,players).filter((entry)=>entry.rarityId===3).length,1);
});

test("solver validates team rating and full chemistry together", () => {
  const players=Array.from({length:11},(_,index)=>player(index,{rating:84,teamId:10,leagueId:20,nationId:30}));
  const result=solveSquad(buildSolverContext({
    players,
    requirementsNormalized:[squadSize,{type:"team_rating",count:84,op:"min",value:[84]},{type:"chemistry_points",count:33,op:"min",value:[33]}],
    requiredPlayers:11,
    squadSlots:Array.from({length:11},(_,index)=>({index,positionName:"CM",isLocked:false,item:null})),
    optimize:{refineSolvedSquad:false,solverTimeBudgetMs:100},
  }));
  assert.equal(result.stats.solved,true);
  assert.equal(result.stats.squadRating,84);
  assert.ok(result.stats.chemistry.totalChem>=33);
});
