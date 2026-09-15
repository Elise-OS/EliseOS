-- Restrict authenticated Jitsi participants to the active Elise call.
local http = require 'net.http';
local json = require 'util.json';
local hashes = require 'util.hashes';
local jid = require 'util.jid';
local st = require 'util.stanza';
local async = require 'util.async';
local util = module:require 'util';
local secret = os.getenv('JWT_APP_SECRET');
local occupants = {};
local function authorized(room, participant, callback)
    if not secret or not participant then callback(false); return; end
    local body = json.encode({room = room, participant = participant});
    http.request('http://api:3000/api/v1/screen-device/conference-auth', {
        method = 'POST'; body = body;
        headers = { ['Content-Type'] = 'application/json'; ['X-Elise-Auth'] = hashes.hmac_sha256(secret, room .. ':' .. participant, true); };
    }, function(response, code)
        local result = code == 201 and json.decode(response or '') or nil;
        callback(result and result.allowed == true or false);
    end);
end
module:hook('muc-occupant-pre-join', function(event)
    if util.is_admin(event.stanza.attr.from) then return; end
    local session = event.origin;
    local participant = session.jitsi_meet_context_user and session.jitsi_meet_context_user.id;
    local room = jid.node(event.room.jid);
    local wait, done = async.waiter(); local allowed = false;
    authorized(room, participant, function(ok) allowed = ok; done(); end); wait();
    if not allowed then session.send(st.error_reply(event.stanza, 'cancel', 'not-allowed', 'Call no longer authorized')); return true; end
    -- A participant may not occupy two seats using the same credential.
    for _, entry in pairs(occupants) do
        if entry.room == event.room and entry.participant == participant and entry.bare ~= jid.bare(event.stanza.attr.from) then
            session.send(st.error_reply(event.stanza, 'cancel', 'conflict', 'Participant already connected')); return true;
        end
    end
    occupants[event.stanza.attr.from] = {room=event.room, participant=participant, bare=jid.bare(event.stanza.attr.from)};
end, 90);
module:hook('muc-occupant-left', function(event)
    for key, entry in pairs(occupants) do if entry.room == event.room and entry.bare == event.occupant.bare_jid then occupants[key] = nil; end end
end);
module:add_timer(3, function()
    for key, entry in pairs(occupants) do
        authorized(jid.node(entry.room.jid), entry.participant, function(ok)
            if not ok then entry.room:set_affiliation(true, entry.bare, 'outcast', 'Call ended'); occupants[key] = nil; end
        end);
    end
    return 3;
end);
