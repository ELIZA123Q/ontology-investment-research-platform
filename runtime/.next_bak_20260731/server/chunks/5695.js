"use strict";exports.id=5695,exports.ids=[5695],exports.modules={28743:(a,b,c)=>{c.d(b,{G4:()=>p,Is:()=>n,JZ:()=>o,Jk:()=>s,VC:()=>t,X$:()=>r,ir:()=>q});var d=c(77598),e=c(2182);let f=["queued","retrying"],g=["queued","running","waiting_for_input","retrying"],h=["queued","running","waiting_for_review","waiting_for_input","retrying","blocked"];function i(a){return a.map(()=>"?").join(",")}function j(a,b){a.exec("BEGIN IMMEDIATE");try{let c=b();return a.exec("COMMIT"),c}catch(b){throw a.exec("ROLLBACK"),b}}function k(a,b){return a.prepare("SELECT * FROM research_jobs WHERE id=?").get(b)}function l(a,b){if(!Number.isFinite(b)||b<1e3)throw Error("任务租约至少为 1 秒");return new Date(Date.parse(a)+b).toISOString()}class m{constructor(a){this.connection=a}get(a){return k(this.connection,a)}listForRun(a){return this.connection.prepare("SELECT * FROM research_jobs WHERE run_id=? ORDER BY created_at DESC").all(a)}listActive(a=20){let b=["queued","running","retrying","waiting_for_input","blocked"];return this.connection.prepare(`SELECT * FROM (
        SELECT research_jobs.*,
          ROW_NUMBER() OVER (
            PARTITION BY run_id,stage,job_type
            ORDER BY created_at DESC
          ) AS latest_rank
        FROM research_jobs
      )
      WHERE latest_rank=1 AND status IN (${i(b)})
      ORDER BY updated_at DESC LIMIT ?`).all(...b,Math.max(1,Math.floor(a)))}enqueue(a){let b=a.now||new Date().toISOString(),c=JSON.stringify(a.inputArtifacts||[]),e=JSON.stringify(a.payload||{}),f=Math.max(1,Math.floor(a.maxAttempts||3));return j(this.connection,()=>{let h=this.connection.prepare(`SELECT * FROM research_jobs WHERE dedupe_key=? AND status IN (${i(g)}) ORDER BY created_at DESC LIMIT 1`).get(a.dedupeKey,...g);if(h)return h;let j={id:(0,d.randomUUID)(),run_id:a.runId,job_type:a.jobType,stage:a.stage||"",artifact_id:a.artifactId||null,status:"queued",dedupe_key:a.dedupeKey,lease_token:null,worker_id:null,lease_expires_at:null,heartbeat_at:null,attempt:0,max_attempts:f,available_at:a.availableAt||b,budget_json:JSON.stringify(a.budget||{}),input_artifacts_json:c,input_hash:`sha256:${(0,d.createHash)("sha256").update(`${c}
${e}`).digest("hex")}`,payload_json:e,result_json:"{}",last_error:null,queued_at:b,started_at:null,finished_at:null,created_at:b,updated_at:b};return this.connection.prepare(`INSERT INTO research_jobs(
        id,run_id,job_type,stage,artifact_id,status,dedupe_key,lease_token,worker_id,lease_expires_at,heartbeat_at,
        attempt,max_attempts,available_at,budget_json,input_artifacts_json,input_hash,payload_json,result_json,last_error,
        queued_at,started_at,finished_at,created_at,updated_at
      ) VALUES(${Array(25).fill("?").join(",")})`).run(...Object.values(j)),j})}recoverExpiredLeases(a=new Date().toISOString()){return Number(this.connection.prepare(`UPDATE research_jobs SET
      status=CASE WHEN attempt >= max_attempts THEN 'blocked' ELSE 'retrying' END,
      available_at=?,
      lease_token=NULL,
      worker_id=NULL,
      lease_expires_at=NULL,
      heartbeat_at=NULL,
      last_error=COALESCE(last_error,'上一个 worker 心跳超时，任务已回收'),
      finished_at=CASE WHEN attempt >= max_attempts THEN ? ELSE NULL END,
      updated_at=?
      WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`).run(a,a,a,a).changes)}claimNext(a){let b=a.now||new Date().toISOString();return j(this.connection,()=>{this.recoverExpiredLeases(b);let c=a.jobTypes?.length?` AND job_type IN (${i(a.jobTypes)})`:"",e=this.connection.prepare(`SELECT id FROM research_jobs
        WHERE status IN (${i(f)})
          AND available_at <= ? AND attempt < max_attempts${c}
        ORDER BY available_at ASC, created_at ASC LIMIT 1`).get(...f,b,...a.jobTypes||[]);if(!e)return;let g=(0,d.randomUUID)(),h=l(b,a.leaseMs);return 1===Number(this.connection.prepare(`UPDATE research_jobs SET
        status='running', lease_token=?, worker_id=?, lease_expires_at=?, heartbeat_at=?,
        attempt=attempt+1, started_at=COALESCE(started_at,?), updated_at=?
        WHERE id=? AND status IN (${i(f)})`).run(g,a.workerId,h,b,b,b,e.id,...f).changes)?k(this.connection,e.id):void 0})}claimById(a,b){let c=b.now||new Date().toISOString();return j(this.connection,()=>{this.recoverExpiredLeases(c);let e=k(this.connection,a);if(!e||!f.includes(e.status)||e.available_at>c||e.attempt>=e.max_attempts||b.jobTypes?.length&&!b.jobTypes.includes(e.job_type))return;let g=(0,d.randomUUID)(),h=l(c,b.leaseMs);return 1===Number(this.connection.prepare(`UPDATE research_jobs SET
        status='running', lease_token=?, worker_id=?, lease_expires_at=?, heartbeat_at=?,
        attempt=attempt+1, started_at=COALESCE(started_at,?), updated_at=?
        WHERE id=? AND status IN (${i(f)})`).run(g,b.workerId,h,c,c,c,a,...f).changes)?k(this.connection,a):void 0})}heartbeat(a,b,c,d=new Date().toISOString()){return 1===Number(this.connection.prepare(`UPDATE research_jobs SET
      heartbeat_at=?, lease_expires_at=?, updated_at=?
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).run(d,l(d,c),d,a,b,d).changes)?k(this.connection,a):void 0}hasActiveLease(a,b,c=new Date().toISOString()){return!!this.connection.prepare(`SELECT 1 FROM research_jobs
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).get(a,b,c)}bindArtifact(a,b,c,d=new Date().toISOString()){return 1===Number(this.connection.prepare(`UPDATE research_jobs SET artifact_id=?, updated_at=?
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).run(c,d,a,b,d).changes)?k(this.connection,a):void 0}finish(a,b,c,d="completed",e=new Date().toISOString()){let f="completed"===d?e:null;return 1===Number(this.connection.prepare(`UPDATE research_jobs SET
      status=?, result_json=?, lease_token=NULL, worker_id=NULL, lease_expires_at=NULL,
      heartbeat_at=?, finished_at=?, updated_at=?
      WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at > ?`).run(d,JSON.stringify(c),e,f,e,a,b,e).changes)?k(this.connection,a):void 0}fail(a,b,c,d={}){let e=d.now||new Date().toISOString();return j(this.connection,()=>{let f=k(this.connection,a);if(!f||"running"!==f.status||f.lease_token!==b||!f.lease_expires_at||f.lease_expires_at<=e)return;let g=!1!==d.retryable&&f.attempt<f.max_attempts,h=g?new Date(Date.parse(e)+Math.max(0,d.retryDelayMs||0)).toISOString():e;return this.connection.prepare(`UPDATE research_jobs SET
        status=?, available_at=?, lease_token=NULL, worker_id=NULL, lease_expires_at=NULL,
        heartbeat_at=NULL, last_error=?, finished_at=?, updated_at=? WHERE id=?`).run(g?"retrying":"blocked",h,c,g?null:e,e,a),k(this.connection,a)})}retryNow(a,b=new Date().toISOString()){return 1===Number(this.connection.prepare(`UPDATE research_jobs SET
      available_at=?, updated_at=?
      WHERE id=? AND status='retrying' AND attempt < max_attempts`).run(b,b,a).changes)?k(this.connection,a):void 0}cancel(a,b,c=new Date().toISOString()){return 1===Number(this.connection.prepare(`UPDATE research_jobs SET
      status='cancelled', lease_token=NULL, worker_id=NULL, lease_expires_at=NULL,
      heartbeat_at=NULL, last_error=?, finished_at=?, updated_at=?
      WHERE id=? AND status IN (${i(h)})`).run(b,c,c,a,...h).changes)?k(this.connection,a):void 0}resolveReviewForArtifact(a,b,c=new Date().toISOString()){if(1===Number(this.connection.prepare(`UPDATE research_jobs SET
      status=?, finished_at=?, updated_at=?, last_error=CASE WHEN ? THEN last_error ELSE '产物未获人工确认' END
      WHERE artifact_id=? AND status='waiting_for_review'`).run(b?"completed":"cancelled",c,c,+!!b,a).changes))return this.connection.prepare("SELECT * FROM research_jobs WHERE artifact_id=? ORDER BY created_at DESC LIMIT 1").get(a)}reopenCompletedBudgetResultForReview(a,b,c=new Date().toISOString()){return j(this.connection,()=>{let d=k(this.connection,a);if(!d||"waiting_for_input"!==d.status||d.artifact_id!==b)return;let e={};try{e=JSON.parse(d.result_json||"{}")}catch{return}if("budget_exceeded"!==e.failure_category||String(e.artifact_id||"")!==b)return;let f=this.connection.prepare("SELECT status,json_content FROM artifacts WHERE id=? AND run_id=?").get(b,d.run_id);if(f&&"needs_review"===f.status&&!(f.json_content.length<3))return 1===Number(this.connection.prepare(`UPDATE research_jobs SET
        status='waiting_for_review', last_error=NULL, finished_at=NULL, updated_at=?
        WHERE id=? AND status='waiting_for_input' AND artifact_id=?`).run(c,a,b).changes)?k(this.connection,a):void 0})}}function n(){return new m((0,e.ar)())}function o(a){return n().enqueue(a)}function p(a){return n().listForRun(a)}function q(a=20){return n().listActive(a)}function r(a,b){return n().resolveReviewForArtifact(a,b)}function s(a,b){return n().cancel(a,b)}function t(a){return n().retryNow(a)}},65695:(a,b,c)=>{c.d(b,{$h:()=>w,Dm:()=>x,IC:()=>A,Mf:()=>v,VV:()=>z,Xd:()=>t,aH:()=>p,nu:()=>y,oQ:()=>u,ol:()=>r});var d=c(91986),e=c(90874),f=c(2182),g=c(28743);let h=`
  id, run_id, kind, version, status, json_content, markdown_content,
  model_name, prompt_version, tool_usage, error_message, created_at, approved_at
`.replace(/\s+/g," ").trim(),i=`
  id, run_id, kind, version, status, model_name, prompt_version,
  tool_usage, error_message, created_at, approved_at
`.replace(/\s+/g," ").trim(),j=`
  id, kind, version, status, model_name, created_at, approved_at,
  CASE WHEN length(trim(COALESCE(markdown_content,''))) > 0 THEN 1 ELSE 0 END AS has_markdown
`.replace(/\s+/g," ").trim(),k=`
  id, run_id, normalized_url, url, title, publisher, published_at, accessed_at, source_type,
  source_tier, authority_type, source_group, locator, captured_at, content_hash,
  usability_status, failure_category, failure_detail, final_url, content_mime, http_status,
  retrieval_status, source_quote, quote_verified
`.replace(/\s+/g," ").trim(),l=`
  id, normalized_url, url, title, content_hash, usability_status, source_tier
`.replace(/\s+/g," ").trim(),m=`
  id, run_id, kind, stage, target_type, target_id, title, status, priority, reason, note,
  source_event_id, artifact_id, attempt, resolution, created_at, updated_at, resolved_at, superseded_at
`.replace(/\s+/g," ").trim();function n(a){return{id:String(a.id),run_id:String(a.run_id),kind:a.kind,stage:String(a.stage),target_type:String(a.target_type),target_id:String(a.target_id),title:String(a.title),status:a.status,priority:a.priority,reason:String(a.reason||""),note:String(a.note||""),source_event_id:a.source_event_id??null,artifact_id:String(a.artifact_id||""),attempt:Number(a.attempt||0),resolution:String(a.resolution||""),created_at:String(a.created_at||""),updated_at:String(a.updated_at||""),resolved_at:a.resolved_at??null,superseded_at:a.superseded_at??null}}let o=(0,d.cache)(function(a,b,c){let d=(0,f.ar)();if(!c)return d.prepare(`SELECT ${h} FROM artifacts WHERE run_id=? AND kind=? ORDER BY version DESC LIMIT 1`).get(a,b);let e=c.split(","),g=e.map(()=>"?").join(",");return d.prepare(`SELECT ${h} FROM artifacts WHERE run_id=? AND kind=? AND status IN (${g}) ORDER BY version DESC LIMIT 1`).get(a,b,...e)});function p(a,b,c){return o(a,b,c?.length?c.join(","):"")}let q=(0,d.cache)(function(a,b,c){if(Number.isFinite(c)&&!(c<=1))return(0,f.ar)().prepare(`SELECT ${h} FROM artifacts
     WHERE run_id=? AND kind=? AND version < ?
     ORDER BY version DESC LIMIT 1`).get(a,b,c)});function r(a,b,c){return q(a,b,c)}let s=(0,d.cache)(function(a,b,c){let d=(0,f.ar)();if(!c)return d.prepare(`SELECT ${i} FROM artifacts WHERE run_id=? AND kind=? ORDER BY version DESC LIMIT 1`).get(a,b);let e=c.split(","),g=e.map(()=>"?").join(",");return d.prepare(`SELECT ${i} FROM artifacts WHERE run_id=? AND kind=? AND status IN (${g}) ORDER BY version DESC LIMIT 1`).get(a,b,...e)});function t(a,b,c){return s(a,b,c?.length?c.join(","):"")}let u=(0,d.cache)(function(a){return(0,f.ar)().prepare(`SELECT ${j} FROM artifacts WHERE run_id=? ORDER BY created_at DESC`).all(a).map(a=>({...a,has_markdown:!!a.has_markdown}))}),v=(0,d.cache)(function(a){return(0,f.ar)().prepare(`SELECT ${k} FROM source WHERE run_id=? ORDER BY accessed_at DESC`).all(a)}),w=(0,d.cache)(function(a){return(0,f.ar)().prepare(`SELECT ${l} FROM source WHERE run_id=? ORDER BY accessed_at DESC`).all(a)}),x=(0,d.cache)(function(a,b){let c=(0,f.ar)();return(b?c.prepare(`SELECT ${m} FROM research_work_items WHERE run_id=? AND status=? ORDER BY created_at DESC`).all(a,b):c.prepare(`SELECT ${m} FROM research_work_items WHERE run_id=? ORDER BY created_at DESC`).all(a)).map(n)}),y=(0,d.cache)(function(a){return(0,f.ar)().prepare("SELECT * FROM research_runs WHERE parent_run_id=? ORDER BY created_at DESC").all(a).map(a=>({id:a.id,question:a.question,domain:a.domain,current_stage:a.current_stage,status:a.status,package_path:a.package_path??null,parent_run_id:a.parent_run_id??null,trigger_event_id:a.trigger_event_id??null,trigger_classification:a.trigger_classification??null,manifest_json:a.manifest_json||"{}",created_at:a.created_at,updated_at:a.updated_at}))}),z=(0,d.cache)(function(a){let b=(0,f.Mh)(a);if(!b)return null;let c=x(a);return{run:b,manifest:(0,e.Ng)(b.manifest_json,b),pendingWorkItems:c.filter(a=>"pending"===a.status||"rework"===a.status),stage03Json:p(a,"stage_03",["approved","needs_review"])?.json_content||"{}",stage04Json:p(a,"stage_04",["approved","needs_review"])?.json_content||"{}",report:t(a,"stage_05",["approved"]),independentReview:p(a,"independent_review",["approved"]),baseline:t(a,"baseline",["approved"]),evaluation:t(a,"evaluation",["approved"]),jobs:(0,g.G4)(a)}}),A=(0,d.cache)(function(a){let b=(0,f.Mh)(a);if(!b)return null;let c=x(a);return{run:b,manifest:(0,e.Ng)(b.manifest_json,b),artifacts:u(a),sources:w(a),work_items:c,jobs:(0,g.G4)(a),pending_count:c.filter(a=>"pending"===a.status||"rework"===a.status).length}})}};